import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { hashCanonicalJson, verifyCitationEnvelope } from "@bio-mcp/shared";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { AlleleRegistryDataDO } from "../do";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { registerVrsId, registerRefgetAccession } from "./vrs-id";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function createStore() {
  const database = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const exec = (query: string, ...values: any[]) => {
    const rows = database.prepare(query).all(...values);
    const iterator = rows[Symbol.iterator]();
    return { toArray: () => rows, one: () => rows[0], next: () => iterator.next(), [Symbol.iterator]: () => iterator };
  };
  const transactionSync = <T>(run: () => T): T => {
    database.exec("BEGIN");
    try { const result = run(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const ctx = { blockConcurrencyWhile: (run: () => Promise<void>) => { ready = run(); return ready; }, storage: { sql: { exec }, transactionSync } };
  const instance = new AlleleRegistryDataDO(ctx as unknown as DurableObjectState, {} as Cloudflare.Env);
  return { database, instance, ready };
}

function fixture() {
  // Exercise generated API helpers and user code; replace only the platform isolate.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockImplementation(async (code, functions) => {
    const staged: Array<Record<string, unknown>> = [];
    try {
      const run = new Function("codemode", "__stagedResults", "console", `return (${code})();`);
      const result = await run(functions, staged, { warn() {}, log() {} });
      return { result: JSON.parse(JSON.stringify(result)), __stagedResults: staged };
    } catch (error) { return { error: String((error as Error).message), __stagedResults: staged }; }
  });
  const stores = new Map<string, ReturnType<typeof createStore>>();
  const namespace = { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (request: Request) => {
    let store = stores.get(id);
    if (!store) { store = createStore(); stores.set(id, store); }
    await store.ready;
    return store.instance.fetch(request);
  } }) };
  const env = { ALLELE_REGISTRY_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env); registerGetSchema(server, env); registerVrsId(server, env); registerRefgetAccession(server, env);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<any> }> })._registeredTools;
  return { tools, close: () => { for (const store of stores.values()) store.database.close(); } };
}

async function recover(f: ReturnType<typeof fixture>, id: string, prefix: string) {
  const rows = async (sql: string) => {
    const output = await f.tools[`${prefix}allele_registry_query_data`].handler({ data_access_id: id, sql }, {});
    expect(output.isError, JSON.stringify(output)).not.toBe(true);
    expect(output.structuredContent.staged).not.toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(30720);
    return output.structuredContent.data.rows;
  };
  const text = async (table: string, column: string, where: string) => {
    const [{ n }] = await rows(`SELECT length(${column}) AS n FROM ${table} WHERE ${where}`);
    let result = "";
    for (let start = 1; start <= n; start += 1000) {
      const [row] = await rows(`SELECT substr(${column}, ${start}, 1000) AS part FROM ${table} WHERE ${where}`);
      result += row.part;
    }
    return result;
  };
  let raw = await text("payloads", "root_json", "id = 1");
  if (raw.startsWith("__CHUNKED__:")) {
    const chunk = raw.slice("__CHUNKED__:".length);
    expect(chunk).toMatch(/^chunk_[a-f0-9]{32}$/);
    const parts = await rows(`SELECT chunk_index FROM content_chunks WHERE content_id = '${chunk}' ORDER BY chunk_index`);
    raw = "";
    for (const part of parts) raw += await text("content_chunks", "chunk_data", `content_id = '${chunk}' AND chunk_index = ${part.chunk_index}`);
  }
  const decoded = JSON.parse(raw);
  return typeof decoded === "string" ? JSON.parse(decoded) : decoded;
}

const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).byteLength;
it("keeps native errors and software version through both Code Mode aliases", async () => {
  const f = fixture();
  const native = {errorType: "IncorrectRequest", message: "Unknown column name: 'gnomAD.id'."};
  const fetcher = vi.fn(async () => Response.json(native, {status: 400, headers: {"X-CAR-Version": "5.1.0"}}));
  vi.stubGlobal("fetch", fetcher);
  try {
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}allele_registry_execute`].handler({code: "return await api.post('/alleles','7-140453136-A-T',{file:'gnomAD.id'});"}, {});
      expect(result).toMatchObject({isError: true, content: expect.any(Array), structuredContent: {success: false, data: {status: 400, data: {provider_response: native, registry_version: "5.1.0"}}}});
      expect(bytes(result)).toBeLessThan(30720);
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { f.close(); }
});
it("materializes every parallel native allele array and retains the complete response", async () => {
  const f = fixture();
  const native = {"@id": "http://reg.genome.network/allele/CA123643", type: "nucleotide",
    genomicAlleles: [{referenceGenome: "GRCh37", hgvs: ["reference:g.1A>T"], coordinates: [{start: 0, end: 1, allele: "T"}]}],
    transcriptAlleles: Array.from({length: 48}, (_, i) => ({referenceSequence: `transcript-${i}`, hgvs: [`transcript-${i}:c.1A>T`], note: "α".repeat(800), coordinates: [{start: i, end: i + 1, allele: "T"}]})),
    aminoAcidAlleles: [{referenceSequence: "protein", hgvs: ["protein:p.Val600Glu"]}],
  };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    for (const prefix of ["", "mcp_"]) {
      const code = "return await api.get('/allele/CA123643', {fields:'all'});";
      const result = await f.tools[`${prefix}allele_registry_execute`].handler({code}, {});
      expect(result.isError, JSON.stringify(result)).not.toBe(true); expect(bytes(result)).toBeLessThan(30720);
      const id = result.structuredContent.data.data_access_id;
      const recovered = await recover(f, id, prefix); expect(recovered).toEqual(native);
      expect(result.structuredContent._meta.citation.result_hash).toBe(await hashCanonicalJson(native));
      for (const [table, count] of [["genomicalleles", 1], ["transcriptalleles", 48], ["aminoacidalleles", 1]]) {
        const query = await f.tools[`${prefix}allele_registry_query_data`].handler({data_access_id: id, sql: `SELECT count(*) AS n FROM ${table}`}, {});
        expect(query.structuredContent.data.rows).toEqual([{n: count}]);
      }
    }
  } finally { f.close(); }
});

it("stages composed and SQL envelopes with verifiable citations and both error fields", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = {code: "return {text: 'α'.repeat(20000)};"};
      const result = await f.tools[`${prefix}allele_registry_execute`].handler(args, {});
      expect(bytes(result)).toBeLessThan(30720); expect(result.structuredContent._staging).toBeDefined();
      const id = result.structuredContent.data_access_id;
      const full = await recover(f, id, prefix); expect(full.structuredContent.data.text).toBe("α".repeat(20000));
      const verified = await verifyCitationEnvelope({citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args, materialized: {value: full}});
      expect(verified.verification).toMatchObject({query: "verified", result: "verified", quarantined: false});
      const sql = {data_access_id: id, sql: "SELECT replace(hex(zeroblob(40000)), '00', 'x') AS value"};
      const query = await f.tools[`${prefix}allele_registry_query_data`].handler(sql, {});
      expect(query.structuredContent._staging).toBeDefined(); expect(bytes(query)).toBeLessThan(30720);
      const stored = await recover(f, query.structuredContent.data_access_id, prefix);
      expect(stored.structuredContent.data.rows[0].value).toBe("x".repeat(40000));
      const failed = await f.tools[`${prefix}allele_registry_query_data`].handler({data_access_id: id, sql: "DELETE FROM payloads"}, {});
      expect(failed).toMatchObject({isError: true, content: expect.any(Array), structuredContent: {success: false}});
    }
  } finally { f.close(); }
});

it("retains oversized offline VRS outputs and labels through both aliases", async () => {
  const f = fixture();
  try {
    for (const prefix of ["", "mcp_"]) {
      const args = {variants: [{refget_accession: "SQ.F-LrLMe1SRpfUZHkQmvkVKFEGaoDeHul", position: 55181320, ref: "A", alt: "T", label: "λ".repeat(20000)}]};
      const result = await f.tools[`${prefix}allele_registry_vrs_id`].handler(args, {});
      expect(bytes(result)).toBeLessThan(30720); expect(result.structuredContent._staging).toBeDefined();
      const full = await recover(f, result.structuredContent.data_access_id, prefix);
      expect(full.structuredContent.data.results[0]).toMatchObject({label: args.variants[0].label, vrs_id: "ga4gh:VA.Hy2XU_-rp4IMh6I_1NXNecBo8Qx8n0oE"});
      const verified = await verifyCitationEnvelope({citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args, materialized: {value: full}});
      expect(verified.verification).toMatchObject({query: "verified", result: "verified", quarantined: false});
    }
  } finally { f.close(); }
});
