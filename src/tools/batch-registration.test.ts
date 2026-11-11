import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";
import {registerVrsId, registerRefgetAccession} from "./vrs-id";
import {alleleRegistryCatalog} from "../spec/catalog";
import {createAlleleRegistryApiFetch} from "../lib/api-adapter";
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers all active tools under both aliases and retains both response fields", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {}); registerVrsId(server); registerRefgetAccession(server);
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema", "vrs_id", "refget_accession"]) {
    expect(tools[`allele_registry_${suffix}`]).toBeDefined(); expect(tools[`mcp_allele_registry_${suffix}`]).toBeDefined();
  }
  expect(await tools.allele_registry_search.handler({query: "batch", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_allele_registry_query_data.handler({data_access_id: "fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages complete arrays, per-input errors, original inputs and cross-reference context", async () => {
  const rows = Array.from({length: 100}, (_, i) => i === 1 ? {errorType: "NotFound", description: "Synthetic"} : {"@id": `http://reg.genome.network/allele/CA${i}`, externalRecords: {Synthetic: [{description: "α source ".repeat(70)}]}, activeUris: i === 2 ? ["http://reg.genome.network/allele/CA200"] : undefined});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(rows)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return json({success: true, tables_created: ["data"], total_rows: 100, input_rows: 100, table_row_counts: {data: 100}}); }
    return json({success: true, schema: {tables: {data: {columns: [{name: "@id"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createAlleleRegistryApiFetch(), catalog: alleleRegistryCatalog, doNamespace: namespace, stagingPrefix: "allele_registry", maxInlineBytes: 30 * 1024});
  const inputs = rows.map((_, i) => `CA${i}`);
  const result = await proxy.handler({method: "POST", path: "/alleles", body: inputs.join("\n"), params: {file: "id"}}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({data: JSON.parse(JSON.stringify(rows)), _mcp: {inputs, error_indices: [1], inactive_indices: [2], positional_mapping_available: true, registration_performed: false}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
it("surfaces attempts to register as incomplete errors before network access", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const proxy = createApiProxyTool({apiFetch: createAlleleRegistryApiFetch(), catalog: alleleRegistryCatalog, stagingPrefix: "allele_registry"});
  expect(await proxy.handler({method: "POST", path: "/alleles", body: "CA1", params: {file: "id+externalSource.synthetic"}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, status: 400});
  expect(fetcher).not.toHaveBeenCalled();
});
