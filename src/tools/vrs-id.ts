/**
 * Compute GA4GH VRS identifiers for variants, offline.
 *
 * VRS digests identify the supplied sequence/interval/alternate representation.
 * Cross-source comparison requires compatible reference and normalization
 * conventions. Registry CA/PA and ClinVar IDs belong to separate identifier
 * systems; a matching protein consequence does not merge nucleotide alleles.
 */
import type { McpServer } from "@bio-mcp/shared/mcp";
import {
	type Allele,
	alleleFromCoords,
	alleleFromVcf,
	alleleId,
	refgetAccessionForSequence,
	sequenceLocationId,
	VrsError,
} from "@bio-mcp/shared/vrs/vrs";
import { z } from "zod";
import { alleleRegistryResponse } from "../lib/tool-result";

/** Keeps one oversized request from monopolising the isolate. */
const MAX_VARIANTS_PER_CALL = 500;

/** Cap on identifiers echoed into the human-readable summary text. */
const SUMMARY_PREVIEW_LIMIT = 20;

const VA_PREFIX = "ga4gh:VA.";

const variantSchema = z.object({
	refget_accession: z
		.string()
		.min(1)
		.describe(
			"Refget accession of the reference sequence, e.g. 'SQ.F-LrLMe1SRpfUZHkQmvkVKFEGaoDeHul'. Bare SQ.<32 chars>, never 'ga4gh:'-prefixed.",
		),
	position: z
		.number()
		.int()
		.optional()
		.describe("1-based VCF position of the first base of ref. Use with ref."),
	ref: z
		.string()
		.optional()
		.describe("Reference allele, VCF style. Use with position."),
	start: z
		.number()
		.int()
		.optional()
		.describe("Interbase (0-based, half-open) start. Use with end."),
	end: z
		.number()
		.int()
		.optional()
		.describe("Interbase (0-based, half-open) end. Use with start."),
	alt: z.string().describe("Alternate allele. Empty string for a deletion."),
	label: z
		.string()
		.optional()
		.describe("Opaque caller label echoed back, for joining results."),
});

export type VariantInput = z.infer<typeof variantSchema>;

export interface VrsSuccess {
	label?: string;
	vrs_id: string;
	vrs_digest: string;
	location_id: string;
	allele: Allele;
}

export interface VrsFailure {
	label?: string;
	error: { code: string; message: string };
}

export type VrsOutcome = VrsSuccess | VrsFailure;

export function isVrsSuccess(outcome: VrsOutcome): outcome is VrsSuccess {
	return "vrs_id" in outcome;
}

function describeError(
	error: unknown,
	fallbackCode: string,
): { code: string; message: string } {
	if (error instanceof VrsError) {
		return { code: error.code, message: error.message };
	}
	if (error instanceof Error) {
		return { code: fallbackCode, message: error.message };
	}
	return { code: fallbackCode, message: String(error) };
}

/** Callers must pick one coordinate convention; mixing them is always a bug. */
function assertSingleConvention(variant: VariantInput): void {
	const usesVcf = variant.position !== undefined || variant.ref !== undefined;
	const usesInterbase =
		variant.start !== undefined || variant.end !== undefined;
	if (usesVcf && usesInterbase) {
		throw new VrsError(
			"AMBIGUOUS_COORDINATES",
			"Supply exactly one of (position + ref) or (start + end).",
		);
	}
	if (!usesVcf && !usesInterbase) {
		throw new VrsError(
			"MISSING_COORDINATES",
			"Supply either (position + ref) or (start + end).",
		);
	}
}

/**
 * Narrowing here (rather than casting at the call site) is what lets both
 * coordinate branches stay type-safe.
 */
export function buildAllele(variant: VariantInput): Allele {
	assertSingleConvention(variant);
	const { position, ref, start, end, alt } = variant;
	const refgetAccession = variant.refget_accession;
	if (position !== undefined && ref !== undefined) {
		return alleleFromVcf({ refgetAccession, position, ref, alt });
	}
	if (start !== undefined && end !== undefined) {
		return alleleFromCoords({ refgetAccession, start, end, alt });
	}
	throw new VrsError(
		"INCOMPLETE_COORDINATES",
		"position requires ref, and start requires end.",
	);
}

export async function computeOne(variant: VariantInput): Promise<VrsOutcome> {
	const label = variant.label === undefined ? {} : { label: variant.label };
	try {
		const allele = buildAllele(variant);
		const id = await alleleId(allele);
		return {
			...label,
			vrs_id: id,
			vrs_digest: id.slice(VA_PREFIX.length),
			location_id: await sequenceLocationId(allele.location),
			allele,
		};
	} catch (error) {
		return { ...label, error: describeError(error, "VRS_COMPUTE_FAILED") };
	}
}

/**
 * Sequential on purpose: digesting is CPU-bound inside the isolate, so fanning
 * out buys nothing and an unbounded `Promise.all` over a 500-item batch just
 * creates 500 simultaneous pending digests.
 */
export async function computeAll(
	variants: VariantInput[],
): Promise<VrsOutcome[]> {
	const results: VrsOutcome[] = [];
	for (const variant of variants) {
		results.push(await computeOne(variant));
	}
	return results;
}

export function summarise(results: VrsOutcome[]): string {
	const succeeded = results.filter(isVrsSuccess);
	const failed = results.length - succeeded.length;
	const lines = succeeded
		.slice(0, SUMMARY_PREVIEW_LIMIT)
		.map(
			(result) => `${result.label ? `${result.label}: ` : ""}${result.vrs_id}`,
		);
	if (succeeded.length > SUMMARY_PREVIEW_LIMIT) {
		lines.push(`… ${succeeded.length - SUMMARY_PREVIEW_LIMIT} more`);
	}
	return [
		`Computed ${succeeded.length} VRS identifier(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
		...lines,
	].join("\n");
}

type ToolDefinition = Parameters<McpServer["registerTool"]>[1];
type ToolInvocation = Parameters<McpServer["registerTool"]>[2];

/** House convention: every tool is reachable under both naming schemes. */
// interlinked: defer function_arg_count -- parameters mirror McpServer.registerTool's own signature
function registerDual(
	server: McpServer,
	baseName: string,
	definition: ToolDefinition,
	invoke: ToolInvocation,
	env: { ALLELE_REGISTRY_DATA_DO?: unknown },
): void {
	const respond: ToolInvocation = (args, extra) => alleleRegistryResponse(
		() => Promise.resolve(invoke(args, extra)) as ReturnType<Parameters<typeof alleleRegistryResponse>[0]>,
		env, baseName, extra, args,
	);
	server.registerTool(`mcp_${baseName}`, definition, respond);
	server.registerTool(baseName, definition, respond);
}

export function registerVrsId(server: McpServer, env: { ALLELE_REGISTRY_DATA_DO?: unknown } = {}): void {
	registerDual(
		server,
		"allele_registry_vrs_id",
		{
			title: "Compute GA4GH VRS Identifiers",
			description:
				"Compute GA4GH VRS computed identifiers (ga4gh:VA.…) for one or more variants. " +
				"Fully offline and deterministic — no upstream call. Use the resulting identifier as the " +
				"join key when combining variant records across servers (clinvar, gnomad, civic, eva); " +
				"ClinVar IDs and ClinGen CAIDs are NOT comparable to each other by string equality. " +
				"VRS comparisons require compatible reference sequences and normalization conventions. " +
				"Accepts either 1-based VCF coordinates (position + ref) or interbase coordinates (start + end).",
			inputSchema: {
				variants: z
					.array(variantSchema)
					.min(1)
					.max(MAX_VARIANTS_PER_CALL)
					.describe(
						"Variants to identify. Each needs a refget_accession and an alt.",
					),
			},
		},
		async (args) => {
			const { variants } = args as { variants: VariantInput[] };
			try {
				const results = await computeAll(variants);
				return {
					content: [{ type: "text" as const, text: summarise(results) }],
					structuredContent: { success: true, data: { results }, _meta: {} },
				};
			} catch (error) {
				const described = describeError(error, "VRS_BATCH_FAILED");
				return {
					content: [
						{ type: "text" as const, text: `Error: ${described.message}` },
					],
					structuredContent: { success: false, error: described },
					isError: true,
				};
			}
		},
		env,
	);
}

export function registerRefgetAccession(server: McpServer, env: { ALLELE_REGISTRY_DATA_DO?: unknown } = {}): void {
	registerDual(
		server,
		"allele_registry_refget_accession",
		{
			title: "Derive Refget Accession For A Sequence",
			description:
				"Derive the GA4GH refget accession (SQ.<digest>) for a literal reference sequence. " +
				"Intended for short references held in hand (transcripts, peptides, contigs); whole " +
				"chromosomes are too large to pass through a tool call — take those accessions from a " +
				"refget service instead.",
			inputSchema: {
				sequence: z
					.string()
					.min(1)
					.describe("Literal residues. Case-insensitive."),
			},
		},
		async (args) => {
			const { sequence } = args as { sequence: string };
			try {
				const accession = await refgetAccessionForSequence(sequence);
				return {
					content: [{ type: "text" as const, text: accession }],
					structuredContent: {
						success: true,
						data: { refget_accession: accession, length: sequence.length },
						_meta: {},
					},
				};
			} catch (error) {
				const described = describeError(error, "REFGET_DERIVE_FAILED");
				return {
					content: [
						{ type: "text" as const, text: `Error: ${described.message}` },
					],
					structuredContent: { success: false, error: described },
					isError: true,
				};
			}
		},
		env,
	);
}
