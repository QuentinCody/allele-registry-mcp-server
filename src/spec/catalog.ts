import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

/**
 * ClinGen Allele Registry REST catalog.
 *
 * The Allele Registry canonicalizes ANY variant representation to one stable,
 * genome-build-agnostic identifier — a CA# (Canonical Allele, from genomic or
 * transcript input) or PA# (Protein Allele, from protein input). This is the
 * same normalization tmVar3 performs offline against a ~550 GB SQLite database;
 * here it is a single unauthenticated HTTP GET.
 *
 * Only two read operations are exposed (both verified live, no auth):
 *   - GET /allele/{caid}  — fetch a record by CA#/PA#
 *   - GET /allele?hgvs=…  — resolve any HGVS to its canonical allele
 *
 * Bulk query and variant registration (POST/PUT /alleles) require login + HMAC
 * auth and are intentionally NOT exposed by this read-only server.
 */
export const alleleRegistryCatalog: ApiCatalog = {
    name: "ClinGen Allele Registry",
    baseUrl: "https://reg.clinicalgenome.org",
    version: "1.01.xx (api v1)",
    auth: "none",
    endpointCount: 2,
    notes:
        "- PURPOSE: canonicalize a variant to a stable, build-agnostic id. Genomic/transcript HGVS → CA# (e.g. CA123643); protein HGVS → PA# (e.g. PA094029). The `@id` field is the canonical URL http://reg.genome.network/allele/<id>.\n" +
        "- HGVS input accepts all three coordinate systems: genomic (NC_000007.14:g.140753336A>T), transcript cDNA (NM_004333.6:c.1799T>A), and protein (NP_004324.2:p.V600E). Protein HGVS accepts BOTH 1-letter (p.V600E) and 3-letter (p.Val600Glu) forms. URL-encode `:` and `>` — the isolate's api.get() encodes query params for you.\n" +
        "- CROSS-REFERENCES: every record carries an `externalRecords` map linking the allele to dbSNP (rs#), ClinVar (ClinVarAlleles + ClinVarVariations), gnomAD (gnomAD_2 + gnomAD_4), ExAC, COSMIC, and MyVariantInfo (hg19 + hg38). So allele → all external database IDs is a single call.\n" +
        "- RECORD SHAPE (JSON-LD): `genomicAlleles[]` (one per referenceGenome: GRCh38 + GRCh37; fields chromosome, coordinates, hgvs, referenceGenome, referenceSequence), `transcriptAlleles[]` (one per RefSeq transcript; fields geneSymbol, geneNCBI_id, hgvs, proteinEffect, referenceSequence, MANE — 48 rows for BRAF V600E), and `aminoAcidAlleles[]` (protein-level).\n" +
        "- REVERSE LOOKUP by external id is NOT available as a simple GET (e.g. ?dbSNP.rs=, ?ClinVar.variationId=, ?gnomAD= all return HTTP 400). Those go through the authenticated bulk POST/PUT /alleles API, which this server does not expose. To resolve an rs#/ClinVar id to a CA#, obtain its HGVS from another source (e.g. the fleet's clinvar or gnomad servers) and call /allele?hgvs=.\n" +
        "- STAGING: a well-cross-referenced variant (BRAF V600E ≈ 32 KB, 48 transcriptAlleles) can exceed the 30 KB inline threshold and auto-stage. Use allele_registry_query_data to SQL over the staged transcript_alleles / genomic_alleles tables.\n" +
        "- Responses are JSON-LD; the adapter sends `Accept: application/json`.",
    endpoints: [
        {
            method: "GET",
            path: "/allele/{caid}",
            summary:
                "Fetch a canonical allele record by its ClinGen Allele Registry id (CA# for genomic canonical alleles, PA# for protein alleles). Returns genomicAlleles, transcriptAlleles, aminoAcidAlleles, and the externalRecords cross-map (dbSNP/ClinVar/gnomAD/ExAC/COSMIC/MyVariantInfo).",
            category: "allele",
            pathParams: [
                {
                    name: "caid",
                    type: "string",
                    required: true,
                    description: "Allele id — CA######## (genomic canonical, e.g. CA123643) or PA###### (protein, e.g. PA094029).",
                },
            ],
            coveredByTool: "allele_registry_search",
        },
        {
            method: "GET",
            path: "/allele",
            summary:
                "Resolve any HGVS expression to its canonical allele plus external cross-references. Genomic (NC_…:g.) and transcript (NM_/NR_…:c./n.) inputs return a CA#; protein (NP_…:p.) inputs return a PA#.",
            category: "allele",
            queryParams: [
                {
                    name: "hgvs",
                    type: "string",
                    required: true,
                    description:
                        "HGVS expression. Examples: NC_000007.14:g.140753336A>T (genomic GRCh38), NM_004333.6:c.1799T>A (transcript), NP_004324.2:p.V600E (protein, 1- or 3-letter accepted). URL-encode ':' and '>'.",
                },
            ],
            coveredByTool: "allele_registry_search",
        },
    ],
};
