import {afterEach, expect, it, vi} from "vitest";
import {createAlleleRegistryApiFetch} from "./api-adapter";
import {alleleRegistryCatalog} from "../spec/catalog";
const api = createAlleleRegistryApiFetch();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json", "Retry-After": "20"}});
// Synthetic contract fixtures, not live normalization evidence.
const allele = {"@id": "http://reg.genome.network/allele/CA123643", type: "nucleotide", genomicAlleles: [{referenceGenome: "GRCh38", referenceSequence: "NC_000007.14", hgvs: ["NC_000007.14:g.140753336A>T"], coordinates: [{start: 140753335, end: 140753336, referenceAllele: "A", allele: "T"}]}], transcriptAlleles: [{hgvs: ["NM_004333.6:c.1799T>A"]}], externalRecords: {ClinVarVariations: [{variationId: 13961, RCV: ["RCV000000001"]}]}, externalSources: {Synthetic: [{url: "https://example.org/evidence"}]}};
const unresolved = {"@id": "_:CA", type: "nucleotide", genomicAlleles: []};
const error = {errorType: "HgvsParsingError", description: "Synthetic invalid input", inputLine: "invalid"};
function stub(data: unknown, status = 200) { const f = vi.fn().mockResolvedValue(json(data, status)); vi.stubGlobal("fetch", f); return f; }
const post = (body: unknown = "NM_004333.6:c.1799T>A", params: Record<string, unknown> = {file: "hgvs"}) => api({method: "POST", path: "/alleles", body, params});
afterEach(() => vi.unstubAllGlobals());
it("sends raw batch text once without authentication, preserving duplicates, errors and unknown IDs", async () => {
  const body = "NM_004333.6:c.1799T>A\ninvalid\nnew\nNM_004333.6:c.1799T>A\n";
  const rows = [allele, error, unresolved, allele]; const fetcher = stub(rows);
  expect((await post(body)).data).toMatchObject({data: rows, _mcp: {input_count: 4, returned_count: 4, count_matches: true, positional_mapping_available: true, error_indices: [1], unregistered_indices: [2], registration_performed: false, response_sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}});
  expect(fetcher).toHaveBeenCalledTimes(1); const [url, init] = fetcher.mock.calls[0];
  expect(String(url)).toBe("https://reg.clinicalgenome.org/alleles?file=hgvs&fields=all");
  expect(init).toMatchObject({method: "POST", body, redirect: "manual", headers: {"Content-Type": "text/plain; charset=utf-8"}});
  expect(init.headers.Authorization).toBeUndefined();
});
it.each(["id", "MyVariantInfo_hg19.id", "MyVariantInfo_hg38.id", "ExAC.id", "gnomAD.id", "gnomAD_2.id", "gnomAD_3.id", "gnomAD_4.id"])("forwards provider file format %s without rewriting inputs", async file => {
  const fetcher = stub([allele]); await post("opaque-provider-input", {file});
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("file")).toBe(file); expect(fetcher.mock.calls[0][1].body).toBe("opaque-provider-input");
});
it.each(["gnomAD_2.id", "gnomAD_3.id", "gnomAD_4.id"])("keeps release-specific reverse selector %s and software version", async field => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([allele]), {headers: {"X-CAR-Version": "5.1.0"}}));
  vi.stubGlobal("fetch", fetcher);
  const result = await api({method: "GET", path: "/alleles", params: {[field]: "7-140753336-A-T"}});
  expect(result.data).toMatchObject({data: [allele], _mcp: {registry_version: "5.1.0", immutable_snapshot: false}});
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get(field)).toBe("7-140753336-A-T");
});
it("retains native rejection of obsolete gnomAD.id without choosing another release", async () => {
  const native = {errorType: "IncorrectRequest", message: "Unknown column name: 'gnomAD.id'."};
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(native), {status: 400, headers: {"X-CAR-Version": "5.1.0"}}));
  vi.stubGlobal("fetch", fetcher);
  await expect(post("7-140453136-A-T", {file: "gnomAD.id"})).rejects.toMatchObject({status: 400, data: {provider_response: native, registry_version: "5.1.0"}});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("preserves inactive record links and rejects positional assumptions on mismatched counts", async () => {
  const inactive = {"@id": "http://reg.genome.network/allele/CA1", activeUris: [allele["@id"]]};
  stub([inactive]); expect((await post("CA1\nCA2", {file: "id"})).data).toMatchObject({data: [inactive], _mcp: {count_matches: false, positional_mapping_available: false, inactive_indices: [0], incomplete: true}});
});
it("preserves literal + in fields projections and original single-read shape", async () => {
  const fetcher = stub(allele); const fields = "none+@id+externalRecords";
  expect(await api({method: "GET", path: "/allele/CA123643", params: {fields}})).toEqual({status: 200, data: allele});
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("fields")).toBe(fields);
});
it("normalizes HGVS without creating a registered ID", async () => {
  stub(unresolved); expect((await api({method: "GET", path: "/allele", params: {hgvs: "NM_004333.6:c.1A>T"}})).data).toEqual(unresolved);
});
it("queries plural reverse cross-references with bounded paging, retaining all matches", async () => {
  const fetcher = stub([allele, unresolved]);
  expect((await api({method: "GET", path: "/alleles", params: {"ClinVar.variationId": "13961"}})).data).toMatchObject({data: [allele, unresolved], _mcp: {query: {"ClinVar.variationId": "13961", limit: 100, skip: 0}, complete: false, immutable_snapshot: false}});
  expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/alleles");
});
it("reads external-source definitions separately from allele cross-records", async () => {
  const source = {name: "Synthetic", url: "https://example.org"}; stub([source]);
  expect((await api({method: "GET", path: "/externalSources"})).data).toMatchObject({data: [source]});
  stub(source); expect((await api({method: "GET", path: "/externalSource/Synthetic"})).data).toMatchObject({data: source});
});
const vcf = "##fileformat=VCFv4.1\n##contig=<ID=chr17,assembly=GRCh37>\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\nchr17\t43009069\t.\tG\tC,T\t59\tPASS\tDB\n";
it("preserves VCF assembly headers and declines one-record-per-result assumptions", async () => {
  const fetcher = stub([allele, unresolved]); const result = await post(vcf, {file: "vcf"});
  expect(result.data).toMatchObject({_mcp: {input_count: 1, returned_count: 2, count_matches: null, positional_mapping_available: false, contig_assemblies: {chr17: "GRCh37"}}});
  expect(fetcher.mock.calls[0][1].body).toBe(vcf);
});
it.each([
  vcf.replace(",assembly=GRCh37", ""), vcf.replace("GRCh37", "guess"), vcf.replace("ID=chr17", "ID=chr18"), vcf.replace("43009069", "0"), vcf.replace("#CHROM\tPOS", "#CHROM POS"),
])("rejects ambiguous or malformed VCF before network %#", async body => {
  const fetcher = stub([]); await expect(post(body, {file: "vcf"})).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [{method: "PUT", path: "/alleles", body: "new", params: {file: "hgvs"}}],
  [{method: "DELETE", path: "/allele/CA1"}],
  [{method: "POST", path: "/alleles", body: "CA1", params: {file: "id+externalSource.example"}}],
  [{method: "GET", path: "/allele/CA1", params: {gbLogin: "user"}}],
  [{method: "GET", path: "/alleles", params: {limit: 10}}],
  [{method: "GET", path: "https://elsewhere.example/alleles"}],
  [{method: "GET", path: "/alleles", params: {gene: "BRAF", limit: 1001}}],
])("blocks registration, credentials, unsafe paths and unbounded collections %#", async request => {
  const fetcher = stub([]); await expect(api(request)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it.each(["a\n\nb", "a\tb", "a\rb", "a\0b", "a\n".repeat(101), "α".repeat(70000), {values: ["a"]}])("rejects invalid or oversized batch body %#", async body => {
  const fetcher = stub([]); await expect(post(body)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("bounds locus queries and preserves caller coordinates without conversion", async () => {
  const fetcher = stub([]); await api({method: "GET", path: "/alleles", params: {refseq: "NM_000546.5", begin: 290, end: 295, limit: 10}});
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("begin")).toBe("290");
  await expect(api({method: "GET", path: "/alleles", params: {gene: "TP53", begin: 1}})).rejects.toMatchObject({status: 400});
});
it.each([403, 429, 503])("preserves provider HTTP %s and errors", async status => {
  stub(error, status); await expect(post()).rejects.toMatchObject({status, data: {provider_response: error, incomplete: true, retry_after: "20"}});
});
it("rejects an HTTP-200 global error instead of treating it as a normalized allele", async () => {
  stub(error); await expect(post()).rejects.toMatchObject({status: 502, data: {provider_response: error}});
});
it("rejects malformed batch envelopes and bounds UTF-8 output", async () => {
  stub({unexpected: true}); await expect(post()).rejects.toMatchObject({status: 502});
  stub([{extra: "α".repeat(2200000)}]); await expect(post()).rejects.toThrow("4 MiB");
});
it("workflow uses one native batch POST with literal newlines and no registration", async () => {
  const recipe = alleleRegistryCatalog.workflows?.[0]; expect(recipe).toBeDefined();
  const send = vi.fn().mockResolvedValue({data: []});
  await new Function("api", `return (async () => {${recipe?.code}})();`)({post: send});
  expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0][1].split("\n")).toHaveLength(3); expect(send.mock.calls[0][2]).toEqual({file: "hgvs", fields: "all"});
});
