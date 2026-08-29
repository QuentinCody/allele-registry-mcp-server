import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { registerRefgetAccession, registerVrsId } from "./tools/vrs-id";
import { AlleleRegistryDataDO } from "./do";

export { AlleleRegistryDataDO };

interface AlleleRegistryEnv {
    ALLELE_REGISTRY_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export class MyMCP extends StatelessMcpWorker {
    server = new McpServer({
        name: "allele_registry",
        version: "0.1.0",
    });

    async init() {

    	configureCitationSigning(this.env);
        const env = this.env as unknown as AlleleRegistryEnv;
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);
        registerCodeMode(this.server, env);
        registerVrsId(this.server);
        registerRefgetAccession(this.server);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return buildHealthResponse("allele-registry");
        }

        if (url.pathname === "/readyz") {
            // Deep check: builds the MCP server the way a real request does, so a
            // factory that throws is a 503 here instead of a green /health over a
            // server that 500s every MCP call.
            return MyMCP.readiness(env, "allele-registry");
        }

        if (url.pathname === "/mcp") {
            return MyMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};
