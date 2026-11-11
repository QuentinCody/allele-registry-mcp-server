import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";

/**
 * Preserve separate native genomicAlleles, transcriptAlleles and aminoAcidAlleles
 * tables. A fixed table-name hint collapses parallel arrays into the first one;
 * generic inference retains every array and its child coordinate records.
 */
export class AlleleRegistryDataDO extends RestStagingDO {}
