/**
 * Co-located smoke test for the ClinGen Allele Registry REST catalog.
 * Verifies the curated surface stays internally consistent.
 */
import { describe, expect, it } from "vitest";
import { alleleRegistryCatalog } from "./catalog";

describe("alleleRegistryCatalog (smoke)", () => {
    it("declares the canonical name, base URL, and no-auth", () => {
        expect(alleleRegistryCatalog.name).toMatch(/Allele Registry/);
        expect(alleleRegistryCatalog.baseUrl).toBe("https://reg.clinicalgenome.org");
        expect(alleleRegistryCatalog.auth).toBe("none");
    });

    it("endpointCount stays in sync with endpoints.length", () => {
        expect(alleleRegistryCatalog.endpointCount).toBe(alleleRegistryCatalog.endpoints.length);
    });

    it("retains single reads and exposes only read-only bulk POST", () => {
        expect(alleleRegistryCatalog.endpoints).toEqual(expect.arrayContaining([
            expect.objectContaining({method: "GET", path: "/allele"}),
            expect.objectContaining({method: "GET", path: "/allele/{caid}"}),
            expect.objectContaining({method: "POST", path: "/alleles"}),
            expect.objectContaining({method: "GET", path: "/alleles"}),
        ]));
        expect(alleleRegistryCatalog.endpoints.every(e => e.method === "GET" || e.method === "POST" && e.path === "/alleles")).toBe(true);
    });

    it("the HGVS endpoint requires an hgvs query param; the id endpoint a caid path param", () => {
        const byHgvs = alleleRegistryCatalog.endpoints.find((e) => e.path === "/allele");
        const byId = alleleRegistryCatalog.endpoints.find((e) => e.path === "/allele/{caid}");
        expect(byHgvs?.queryParams?.some((p) => p.name === "hgvs" && p.required)).toBe(true);
        expect(byId?.pathParams?.some((p) => p.name === "caid" && p.required)).toBe(true);
    });
});
