export function fail(message: string, status = 400, data?: unknown): never {
  throw Object.assign(new Error(message), {status, data: {incomplete: true, ...(data && typeof data === "object" ? data : {})}});
}
export const FILE_FORMATS = ["hgvs", "id", "MyVariantInfo_hg19.id", "MyVariantInfo_hg38.id", "ExAC.id", "gnomAD.id", "gnomAD_2.id", "gnomAD_3.id", "gnomAD_4.id", "vcf"] as const;
export const EXTERNAL_FILTERS = ["ClinVar.variationId", "ClinVar.alleleId", "ClinVar.RCV", "dbSNP.rs", "MyVariantInfo_hg19.id", "MyVariantInfo_hg38.id", "ExAC.id", "gnomAD.id", "gnomAD_2.id", "gnomAD_3.id", "gnomAD_4.id"];
const assemblies = new Set(["NCBI36", "GRCh37", "GRCh38", "hg18", "hg19"]);
export function batchInput(body: unknown, format: unknown) {
  if (typeof format !== "string" || !(FILE_FORMATS as readonly string[]).includes(format)) fail("Use a documented read-only file format; registration/link formats are unsupported");
  if (typeof body !== "string" || !body || new TextEncoder().encode(body).length > 128 * 1024 || body.includes("\0")) fail("Supply a nonempty raw text body of at most 128 KiB");
  const lines = body.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.some(line => !line.trim() || line.includes("\r"))) fail("Do not include blank input lines or bare carriage returns");
  if (format !== "vcf") {
    if (lines.length > 100 || lines.some(line => line.includes("\t") || line.length > 8000)) fail("Use 1–100 single-column inputs of at most 8000 characters each");
    return {format, inputs: lines, input_count: lines.length, positional: true};
  }
  if (!lines[0].startsWith("##fileformat=VCFv4.") || !lines.some(line => line.startsWith("#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO"))) fail("VCF requires fileformat and tab-separated column headers");
  const contigs = new Map<string, string>();
  for (const line of lines.filter(line => line.startsWith("##contig=<"))) {
    const id = /(?:<|,)ID=([^,>]+)/.exec(line)?.[1];
    const assembly = /(?:<|,)assembly=([^,>]+)/.exec(line)?.[1];
    if (!id || !assembly || !assemblies.has(assembly)) fail("Every VCF contig needs explicit ID and a documented assembly (NCBI36, GRCh37, GRCh38, hg18, hg19)");
    if (contigs.has(id) && contigs.get(id) !== assembly) fail("Conflicting VCF contig assemblies");
    contigs.set(id, assembly);
  }
  const records = lines.filter(line => !line.startsWith("#"));
  if (!records.length || records.length > 100) fail("Use 1–100 VCF records");
  for (const line of records) {
    const cols = line.split("\t");
    if (cols.length < 8 || !contigs.has(cols[0]) || !/^(?:chr)?(?:[1-9]|1[0-9]|2[0-2]|X|Y|M|MT)$/.test(cols[0]) || !/^[1-9]\d*$/.test(cols[1]) || !cols[3] || !cols[4]) fail("VCF rows need a documented chromosome, positive position, REF/ALT and a matching contig assembly header");
  }
  // Do not zip result alleles to VCF rows: multiallelic records can expand.
  return {format, inputs: records, input_count: records.length, positional: false, contig_assemblies: Object.fromEntries(contigs)};
}
export function batchContext(data: unknown, input: ReturnType<typeof batchInput>) {
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row))) fail("Allele Registry batch response must be an array of allele/error objects", 502);
  const countMatches = input.positional ? data.length === input.input_count : null;
  return {...input, returned_count: data.length, count_matches: countMatches,
    positional_mapping_available: input.positional && countMatches,
    error_indices: data.flatMap((row, i) => "errorType" in row ? [i] : []),
    unregistered_indices: data.flatMap((row, i) => typeof row["@id"] === "string" && row["@id"].startsWith("_:") ? [i] : []),
    inactive_indices: data.flatMap((row, i) => Array.isArray(row.activeUris) ? [i] : []),
    index_basis: "zero-based response index; input correspondence uses documented order only for non-VCF batches with matching counts",
    registration_performed: false, incomplete: countMatches === false,
    note: "Do not drop per-input error objects or deduplicate inputs. Blank-node @id values are unregistered alleles, not CA/PA identifiers. Keep inactive activeUris, genome builds, reference versions, coordinate conventions and externalRecords/externalSources separately. Matching counts do not independently validate ordering. VCF result order is not mapped to input rows here.",
  };
}
