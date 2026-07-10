import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const ALLELE_REGISTRY_BASE = "https://reg.clinicalgenome.org";

export interface AlleleRegistryFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the ClinGen Allele Registry API.
 * No auth required for read operations (GET /allele/{caid}, GET /allele?hgvs=...).
 * Returns JSON-LD when `Accept: application/json` is sent.
 */
export async function alleleRegistryFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: AlleleRegistryFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? ALLELE_REGISTRY_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "allele-registry-mcp-server/1.0 (bio-mcp)",
    });
}
