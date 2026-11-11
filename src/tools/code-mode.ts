import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { alleleRegistryCatalog } from "../spec/catalog";
import { createAlleleRegistryApiFetch } from "../lib/api-adapter";
import { alleleRegistryResponse } from "../lib/tool-result";

interface CodeModeEnv {
    ALLELE_REGISTRY_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createAlleleRegistryApiFetch();
    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof alleleRegistryResponse>[0]>;
        const respond = (args: unknown, extra: unknown) => alleleRegistryResponse(() => handler(args, extra), env, String(name), extra, args);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    }};

    const searchTool = createSearchTool({
        prefix: "allele_registry",
        catalog: alleleRegistryCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "allele_registry",
        // Verifiable provenance: allele_registry_execute results carry a _meta.citation.
        source: {
            id: "allele_registry",
            name: "ClinGen Allele Registry",
            url: "https://reg.clinicalgenome.org",
        },
        catalog: alleleRegistryCatalog,
        apiFetch,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        preserveApiErrors: true,
        timeout: 90_000,
        doNamespace: env.ALLELE_REGISTRY_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
