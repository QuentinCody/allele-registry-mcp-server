import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { alleleRegistryCatalog } from "../spec/catalog";
import { createAlleleRegistryApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    ALLELE_REGISTRY_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createAlleleRegistryApiFetch();

    const searchTool = createSearchTool({
        prefix: "allele_registry",
        catalog: alleleRegistryCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "allele_registry",
        // Verifiable provenance: allele_registry_execute results carry a _meta.citation.
        source: {
            id: "allele_registry",
            name: "ClinGen Allele Registry",
            url: "https://reg.clinicalgenome.org",
            license: "ClinGen / NIH — freely available (see reg.clinicalgenome.org terms)",
        },
        catalog: alleleRegistryCatalog,
        apiFetch,
        doNamespace: env.ALLELE_REGISTRY_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
