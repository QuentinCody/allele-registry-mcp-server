# ClinGen Allele Registry MCP server

Read canonical allele records and their cross-references through the ClinGen Allele Registry. CA identifiers describe nucleotide alleles; PA identifiers describe protein alleles. These are registry-assigned identifiers, distinct from the offline GA4GH VRS digests also provided by this server. Preserve assembly, reference sequence/version and coordinate context when joining records across sources.

The Cloudflare Worker uses `StatelessMcpWorker`, REST and Code Mode. Development port: **8905**.

## Tools

All active tool families have both ordinary and `mcp_` aliases:

- `allele_registry_search` — discover endpoints and recipes.
- `allele_registry_execute` — execute JavaScript with `api.get()`/`api.post()`; results carry citation metadata.
- `allele_registry_get_schema` / `allele_registry_query_data` — inspect and query staged responses.
- `allele_registry_vrs_id` / `allele_registry_refget_accession` — existing offline identifier helpers.

## Read-only batch normalization

The [official API specification](https://reg.clinicalgenome.org/doc/AlleleRegistry_1.01.xx_api_v1.pdf) distinguishes unauthenticated GET/POST queries from authenticated PUT registration. This adapter exposes queries only; it rejects registration methods, authentication parameters and link-registration file formats. The former catalog incorrectly classified batch POST as authenticated.

```js
const inputs = [
  "NC_000007.14:g.140753336A>T",
  "NM_004333.6:c.1799T>A",
  "NP_004324.2:p.Val600Glu"
];
return await api.post("/alleles", inputs.join("\n"), {
  file: "hgvs",
  fields: "all"
});
```

Send raw text, not a JSON array or form body. Current `file` formats are `hgvs`, `id`, `MyVariantInfo_hg19.id`, `MyVariantInfo_hg38.id`, `ExAC.id`, `gnomAD_2.id`, `gnomAD_3.id`, `gnomAD_4.id` and `vcf`. Limits: 100 inputs/VCF records and 128 KiB. VCF requires a contig declaration with an explicit supported assembly for every chromosome used; the adapter preserves the original text and does not infer a build.

Live software version 5.1.0 rejects the older PDF's `gnomAD.id` format and query selector. Legacy calls retain the native HTTP 400 evidence; the adapter never silently picks a replacement release. Use `gnomAD_2.id` with GRCh37 identifiers or `gnomAD_3.id`/`gnomAD_4.id` with GRCh38 identifiers. Normalization can succeed even when the corresponding release has no reverse cross-reference match.

The response retains the native array under `data`, with inputs, counts, error/unregistered/inactive indices and provenance under `_mcp`. Non-VCF batches use the provider's documented order only when counts match. Duplicate inputs are retained. A blank-node `@id` such as `_:CA` means the allele has no registered ID; normalization does not register it. Inactive records retain `activeUris`. VCF outputs are not zipped to input rows because multiallelic records can expand. Per-input errors remain alongside successful results.

## Reverse cross-references and source discovery

Reverse lookup uses plural `/alleles`, not singular `/allele`:

```js
return await api.get("/alleles", {
  "ClinVar.variationId": "13961",
  limit: 10,
  fields: "all"
});
```

Other selectors include ClinVar allele/RCV IDs, dbSNP rs numbers, MyVariantInfo/ExAC and release-specific gnomAD IDs, names, genes, reference-sequence loci and published external sources. Collection queries require a selector, default to 100 records and allow at most 1,000; `skip` supports paging. Results can have zero or multiple matches and represent a mutable query, not an immutable release snapshot. Batch/collection/source `_mcp.registry_version` preserves the observed `X-CAR-Version` software header (or `null` if absent), not a data release or snapshot pin.

`/externalSources` and `/externalSource/{sourceName}` describe user-published links. These differ from `externalRecords`, the provider's cross-database mappings. `fields=all` includes both where available; literal `+` in narrower field projections is URL-encoded. Links alone do not establish pathogenicity or clinical equivalence.

Existing `/allele/{caid}` and `/allele?hgvs=...` retain their native JSON-LD response shapes. New batch, collection and source-discovery routes return `data` plus `_mcp`. Responses over 30 KiB stage; upstream reads have a 50-second timeout and 4 MiB cap. Narrow fields or split batches when needed. No automatic registration or following of returned links occurs.

All tools, including offline VRS helpers and SQL/schema reads, stage complete responses above 30 KiB. Both success and error paths preserve their response fields and citations. A top-level `staged: true` handle stores the original tool envelope in `payloads`; `data.__staged` stores the provider-adapter payload. Recover long strings with bounded `substr` queries, following `__CHUNKED__` references through `content_chunks`. New single-record datasets use separate native-array tables such as `genomicalleles` and `transcriptalleles`; inspect each handle's schema before querying it.

## Validation status (2026-10-03)

Native/provider comparisons and the local Worker verify batch normalization, partial errors, duplicates, unregistered blank-node IDs, multiallelic VCF, release-specific external-ID reads, paging, source discovery and all three catalog recipes. Complete staged recovery, independent genomic/transcript tables, native errors, canonical citations and oversized SQL/VRS results pass. Inactive-link handling remains fixture-tested; this sample did not include an inactive record. Software version 5.1.0 was observed, without inferring a publication date or data snapshot. See the [implementation tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md) for checks and deployment status.

## Development

```bash
./scripts/dev-servers.sh allele-registry
pnpm --filter allele-registry-mcp-server run test
```

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from ClinGen Allele Registry and stays under the terms of that source: No terms found for the registry; ClinGen curated content is CC0, but that statement does not name the registry.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
