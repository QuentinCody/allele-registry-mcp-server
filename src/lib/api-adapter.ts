import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {batchInput, batchContext, EXTERNAL_FILTERS, fail} from "./batch";
import {registryRead} from "./read";
const BASE = "https://reg.clinicalgenome.org";
export function createAlleleRegistryApiFetch(): ApiFetchFn {
  return async (request) => {
    const params = {...request.params};
    const batch = request.method === "POST" && request.path === "/alleles";
    if (!batch && (request.method !== "GET" || request.body !== undefined)) fail("Only GET reads and read-only POST /alleles batches are supported; PUT registration is not exposed");
    const single = request.path === "/allele" || /^\/allele\/(?:CA|PA)\d+$/.test(request.path);
    const source = request.path === "/externalSources" || /^\/externalSource\/[A-Za-z0-9_-]+$/.test(request.path);
    if (!single && !source && request.path !== "/alleles") fail("Use a documented allele read or external-source discovery route");
    const allowed = batch ? ["file", "fields"] : single ? ["hgvs", "fields"] : source ? ["fields"] : ["fields", "skip", "limit", "name", "gene", "refseq", "begin", "end", "externalSource", ...EXTERNAL_FILTERS];
    for (const [key, value] of Object.entries(params)) {
      if (!allowed.includes(key) || !["string", "number"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value) || String(value).length > 8000) fail("Unsupported or invalid Allele Registry query parameter");
    }
    const { result, input } = await readAlleleQuery(batch, request, params);
    if (single) return {status: result.status, data: result.data};
    if (request.path === "/alleles" && !Array.isArray(result.data)) fail("Allele query must return an array", 502);
    return {status: result.status, data: {data: result.data, _mcp: {...result.provenance,
      ...(input ? batchContext(result.data, input) : {query: params, registration_performed: false, complete: false, immutable_snapshot: false}),
    }}};
  };
}

async function readAlleleQuery(batch: boolean, request: Parameters<ApiFetchFn>[0], params: { [x: string]: unknown; }) {
  const input = batch ? batchInput(request.body, params.file) : undefined;
  if (request.path === "/alleles" && !batch) {
    validateAlleleListParameters(params);
  }
  if (request.path === "/allele" && (typeof params.hgvs !== "string" || !params.hgvs.trim())) fail("Single-allele normalization requires hgvs");
  if (batch) params.fields ??= "all";
  const url = new URL(`${BASE}${request.path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  if (url.href.length > 20000) fail("Allele Registry query URL exceeds 20000 characters");
  const result = await registryRead(url, request.method, batch ? request.body as string : undefined);
  return { result, input };
}

function validateAlleleListParameters(params: { [x: string]: unknown; }) {
  if (!Object.keys(params).some(key => !["fields", "skip", "limit", "begin", "end"].includes(key))) fail("Select an external ID, name, gene, reference sequence or external source before querying alleles");
  params.limit ??= 100; params.skip ??= 0;
  for (const key of ["limit", "skip", "begin", "end"]) if (params[key] !== undefined && (!Number.isSafeInteger(params[key]) || Number(params[key]) < (key === "limit" ? 1 : 0))) fail(`${key} must be a nonnegative integer (limit must be positive)`);
  if (Number(params.limit) > 1000) fail("limit must be at most 1000");
  if ((params.begin !== undefined || params.end !== undefined) && !params.refseq) fail("Locus bounds require refseq");
  if (params.begin !== undefined && params.end !== undefined && Number(params.begin) > Number(params.end)) fail("begin must not exceed end");
}
