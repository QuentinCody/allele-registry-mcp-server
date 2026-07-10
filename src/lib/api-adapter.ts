import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { alleleRegistryFetch } from "./http";

/**
 * Adapter from the Allele Registry HTTP surface to the Code Mode `ApiFetchFn`.
 *
 * The registry is a flat REST/JSON-LD service — no trailing-slash routing quirk
 * (unlike InterPro's DRF), no version header. Paths are passed through as-is;
 * HGVS strings in query params (which contain `:` and `>`) are URL-encoded by
 * `restFetch`. Responses are JSON-LD (`@context`/`@id`/`type`).
 */
export function createAlleleRegistryApiFetch(): ApiFetchFn {
    return async (request) => {
        const response = await alleleRegistryFetch(request.path, request.params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
                status: number;
                data: unknown;
            };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: { text } };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
