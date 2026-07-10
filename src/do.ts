import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

/**
 * Staging DO for ClinGen Allele Registry records.
 *
 * An allele record is a single JSON-LD object whose tabular payload lives in
 * three parallel arrays: `genomicAlleles` (per reference genome), the usually
 * largest `transcriptAlleles` (one row per RefSeq transcript — 48 for BRAF
 * V600E), and `aminoAcidAlleles` (protein-level). We hint the dominant array
 * so a staged record lands in a sensibly-named, indexed table.
 */
export class AlleleRegistryDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
        const obj = data as Record<string, unknown>;

        if (Array.isArray(obj.transcriptAlleles) && obj.transcriptAlleles.length > 0) {
            return { tableName: "transcript_alleles", indexes: ["geneSymbol", "geneNCBI_id"] };
        }
        if (Array.isArray(obj.aminoAcidAlleles) && obj.aminoAcidAlleles.length > 0) {
            return { tableName: "amino_acid_alleles", indexes: ["geneSymbol"] };
        }
        if (Array.isArray(obj.genomicAlleles) && obj.genomicAlleles.length > 0) {
            return { tableName: "genomic_alleles", indexes: ["chromosome", "referenceGenome"] };
        }
        return undefined;
    }
}
