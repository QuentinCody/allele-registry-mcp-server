import { describe, expect, it } from "vitest";
import {
	buildAllele,
	computeAll,
	computeOne,
	isVrsSuccess,
	summarise,
	type VariantInput,
	type VrsOutcome,
} from "./vrs-id";

/** EGFR NC_000007.14:g.55181320A>T — the GA4GH reference implementation's vector. */
const EGFR_ACCESSION = "SQ.F-LrLMe1SRpfUZHkQmvkVKFEGaoDeHul";
const EGFR_VRS_ID = "ga4gh:VA.Hy2XU_-rp4IMh6I_1NXNecBo8Qx8n0oE";
const EGFR_LOCATION_ID = "ga4gh:SL._G2K0qSioM74l_u3OaKR0mgLYdeTL7Xd";

function vcfVariant(overrides: Partial<VariantInput> = {}): VariantInput {
	return {
		refget_accession: EGFR_ACCESSION,
		position: 55181320,
		ref: "A",
		alt: "T",
		...overrides,
	};
}

function expectSuccess(outcome: VrsOutcome) {
	if (!isVrsSuccess(outcome)) {
		throw new Error(`expected success, got error: ${outcome.error.message}`);
	}
	return outcome;
}

describe("buildAllele", () => {
	it("builds from VCF coordinates", () => {
		const allele = buildAllele(vcfVariant());
		expect(allele.location.start).toBe(55181319);
		expect(allele.location.end).toBe(55181320);
		expect(allele.state.sequence).toBe("T");
	});

	it("builds from interbase coordinates", () => {
		const allele = buildAllele({
			refget_accession: EGFR_ACCESSION,
			start: 55181319,
			end: 55181320,
			alt: "T",
		});
		expect(allele.location.start).toBe(55181319);
	});

	it("rejects mixing both coordinate conventions", () => {
		expect(() =>
			buildAllele(vcfVariant({ start: 1, end: 2 })),
		).toThrow(/exactly one/);
	});

	it("rejects supplying neither convention", () => {
		expect(() =>
			buildAllele({ refget_accession: EGFR_ACCESSION, alt: "T" }),
		).toThrow(/Supply either/);
	});

	it("rejects a half-specified convention", () => {
		expect(() =>
			buildAllele({ refget_accession: EGFR_ACCESSION, position: 10, alt: "T" }),
		).toThrow(/position requires ref/);
	});
});

describe("computeOne", () => {
	it("returns the reference implementation's identifier", async () => {
		const result = expectSuccess(await computeOne(vcfVariant()));
		expect(result.vrs_id).toBe(EGFR_VRS_ID);
		expect(result.location_id).toBe(EGFR_LOCATION_ID);
	});

	it("exposes the bare digest without the CURIE prefix", async () => {
		const result = expectSuccess(await computeOne(vcfVariant()));
		expect(result.vrs_digest).toBe("Hy2XU_-rp4IMh6I_1NXNecBo8Qx8n0oE");
		expect(result.vrs_id.endsWith(result.vrs_digest)).toBe(true);
	});

	it("agrees between VCF and interbase inputs for the same variant", async () => {
		const fromVcf = expectSuccess(await computeOne(vcfVariant()));
		const fromInterbase = expectSuccess(
			await computeOne({
				refget_accession: EGFR_ACCESSION,
				start: 55181319,
				end: 55181320,
				alt: "T",
			}),
		);
		expect(fromInterbase.vrs_id).toBe(fromVcf.vrs_id);
	});

	it("echoes the caller label back for joining", async () => {
		const result = expectSuccess(
			await computeOne(vcfVariant({ label: "clinvar:12345" })),
		);
		expect(result.label).toBe("clinvar:12345");
	});

	it("reports a structured error instead of throwing on a bad accession", async () => {
		const outcome = await computeOne(
			vcfVariant({ refget_accession: "not-an-accession", label: "row-7" }),
		);
		expect(isVrsSuccess(outcome)).toBe(false);
		expect(outcome).toMatchObject({
			label: "row-7",
			error: { code: "INVALID_REFGET_ACCESSION" },
		});
	});

	it("surfaces the namespace-prefix mistake with its own code", async () => {
		const outcome = await computeOne(
			vcfVariant({ refget_accession: `ga4gh:${EGFR_ACCESSION}` }),
		);
		expect(outcome).toMatchObject({
			error: { code: "NAMESPACED_REFGET_ACCESSION" },
		});
	});
});

describe("computeAll", () => {
	it("preserves input order and keeps failures inline", async () => {
		const results = await computeAll([
			vcfVariant({ label: "ok-1" }),
			vcfVariant({ refget_accession: "bad", label: "bad-1" }),
			vcfVariant({ alt: "G", label: "ok-2" }),
		]);
		expect(results).toHaveLength(3);
		expect(results.map((result) => result.label)).toEqual([
			"ok-1",
			"bad-1",
			"ok-2",
		]);
		expect(isVrsSuccess(results[0])).toBe(true);
		expect(isVrsSuccess(results[1])).toBe(false);
		expect(isVrsSuccess(results[2])).toBe(true);
	});

	it("gives distinct identifiers to distinct alt alleles", async () => {
		const [first, second] = await computeAll([
			vcfVariant({ alt: "T" }),
			vcfVariant({ alt: "G" }),
		]);
		expect(expectSuccess(first).vrs_id).not.toBe(expectSuccess(second).vrs_id);
	});
});

describe("summarise", () => {
	it("counts successes and failures", async () => {
		const results = await computeAll([
			vcfVariant({ label: "a" }),
			vcfVariant({ refget_accession: "bad", label: "b" }),
		]);
		const text = summarise(results);
		expect(text).toContain("Computed 1 VRS identifier(s), 1 failed.");
		expect(text).toContain(`a: ${EGFR_VRS_ID}`);
	});

	it("omits the failure clause when everything succeeded", async () => {
		const text = summarise(await computeAll([vcfVariant()]));
		expect(text).toContain("Computed 1 VRS identifier(s).");
		expect(text).not.toContain("failed");
	});

	it("truncates the preview past 20 identifiers", async () => {
		const variants = Array.from({ length: 25 }, (_, index) =>
			vcfVariant({ position: 55181320 + index, label: `v${index}` }),
		);
		const text = summarise(await computeAll(variants));
		expect(text).toContain("Computed 25 VRS identifier(s).");
		expect(text).toContain("… 5 more");
	});
});
