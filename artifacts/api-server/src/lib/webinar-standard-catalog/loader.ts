import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  RULE_COUNT, STANDARD_ID, STANDARD_VERSION,
  type CatalogValidationIssue, type WebinarStandardCatalog,
} from "./types";
import { validateWebinarStandardCatalog } from "./validate";

export const PACKAGE_REVISION = "RC1.1" as const;
export type PackageRevision = typeof PACKAGE_REVISION;
const CATALOG_FILENAME = "docs/standards/webinar/WEB-STANDARD-001.rules.json";
const MANIFEST_FILENAME = "docs/standards/webinar/manifest.json";
const PAYLOAD_FILENAMES = [
  CATALOG_FILENAME,
  "docs/standards/webinar/WEB-STANDARD-001.md",
  "docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md",
  "docs/standards/webinar/CHANGELOG-RC1.md",
] as const;

const evidenceRecord = z.object({
  pass: z.literal(true),
  evidence: z.string().refine((value) => value.trim().length > 0, "Evidence must be non-empty"),
}).strict();

// These are recorded manifest assertions, not executable rule evaluators.
const manifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  standardId: z.literal(STANDARD_ID),
  standardVersion: z.literal(STANDARD_VERSION),
  packageRevision: z.literal(PACKAGE_REVISION),
  packageRevisionNote: z.string().min(1),
  ruleCount: z.literal(RULE_COUNT),
  uniqueRuleIdCount: z.literal(RULE_COUNT),
  duplicateRuleIdCount: z.literal(0),
  nullRequiredFieldCount: z.literal(0),
  placeholderTermCount: z.literal(0),
  invalidEnumerationCount: z.literal(0),
  nonBooleanExceptionEligibleCount: z.literal(0),
  semanticValidationCount: z.literal(14),
  semanticValidationPassedCount: z.literal(14),
  semanticValidationFailedCount: z.literal(0),
  semanticValidation: z.object({
    registrationSuppressesFutureRecruitment: evidenceRecord,
    internalTestExcludedFromCustomerPathsAndReporting: evidenceRecord,
    noCommunicationScheduledInPast: evidenceRecord,
    eventStatusAndParticipantStatusSeparate: evidenceRecord,
    attendancePerRegistrant: evidenceRecord,
    attendedAbsentDistinctVariants: evidenceRecord,
    attendanceUnknownCannotGenerateBothVariants: evidenceRecord,
    sharedFollowUpAssetsPermitted: evidenceRecord,
    registrationTestingNonOverridable: evidenceRecord,
    joinLinkVenueTestingNonOverridable: evidenceRecord,
    requiredConsentControlsNonOverridable: evidenceRecord,
    governedNamingTaxonomyUtmNonBypassable: evidenceRecord,
    noRuleAuthorizesExternalSend: evidenceRecord.extend({
      interpretiveNote: z.string().min(1),
    }).strict(),
    noRuleAuthorizesDeployment: evidenceRecord,
  }).strict(),
  generatedAtUtc: z.string().refine(
    (value) => Number.isFinite(Date.parse(value)), "Must be a valid timestamp",
  ),
  files: z.array(z.object({
    filename: z.enum(PAYLOAD_FILENAMES),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).length(PAYLOAD_FILENAMES.length),
  manifestSelfHashNote: z.string().min(1),
  validationResult: z.literal("PASSED"),
  validationSummary: z.string().min(1),
}).strict();

export class CatalogLoadError extends Error {
  readonly issues: readonly CatalogValidationIssue[];

  constructor(issues: readonly CatalogValidationIssue[]) {
    super(`Webinar standard catalog could not be loaded (${issues.length} issue(s))`);
    this.name = "CatalogLoadError";
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({
      ...issue,
      location: Object.freeze([...issue.location]),
    })));
  }
}

export interface CatalogLoadOptions {
  /** Absolute checkout root. Pass explicitly when using bundled/relocated code. */
  readonly repositoryRoot?: string;
}

export interface CatalogPaths {
  readonly repositoryRoot: string;
  readonly catalogPath: string;
  readonly manifestPath: string;
}

/** Default is relative to this source module, never process.cwd() or an environment variable. */
export function resolveWebinarStandardCatalogPaths(repositoryRoot?: string): CatalogPaths {
  const root = repositoryRoot === undefined
    ? fileURLToPath(new URL("../../../../../", import.meta.url))
    : repositoryRoot;
  if (!isAbsolute(root)) {
    throw new CatalogLoadError([{
      code: "invalid_value", field: "repositoryRoot", location: ["repositoryRoot"],
      message: "repositoryRoot must be an absolute path", valueSummary: root,
    }]);
  }
  return Object.freeze({
    repositoryRoot: resolve(root),
    catalogPath: resolve(root, CATALOG_FILENAME),
    manifestPath: resolve(root, MANIFEST_FILENAME),
  });
}

async function readBytes(path: string, field: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error: unknown) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code : "unknown";
    throw new CatalogLoadError([{
      code: "read_error", field, location: [field],
      message: `Unable to read ${field}`, valueSummary: code,
    }]);
  }
}

function parseJson(bytes: Buffer, field: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new CatalogLoadError([{
      code: "invalid_json", field, location: [field],
      message: `${field} must contain valid JSON`, valueSummary: `${bytes.length} bytes`,
    }]);
  }
}

function manifestValueSummary(input: unknown, path: readonly PropertyKey[]): string {
  let value = input;
  for (const part of path) {
    if (typeof value !== "object" || value === null || !Object.hasOwn(value, part)) {
      return "missing";
    }
    value = Reflect.get(value, part) as unknown;
  }
  if (value === null) return "null";
  if (Array.isArray(value)) return `array with ${value.length} entries`;
  if (typeof value === "object") return `object with ${Object.keys(value).length} keys`;
  return String(value).slice(0, 200);
}

/**
 * Reads on each call; never caches, mutates source documents, or initializes the engine.
 * Validates the manifest's own declarations independently of catalog validation.
 */
export async function loadWebinarStandardCatalog(
  options: CatalogLoadOptions = {},
): Promise<WebinarStandardCatalog> {
  const paths = resolveWebinarStandardCatalogPaths(options.repositoryRoot);
  const [catalogBytes, manifestBytes] = await Promise.all([
    readBytes(paths.catalogPath, "catalog"),
    readBytes(paths.manifestPath, "manifest"),
  ]);
  const manifestInput = parseJson(manifestBytes, "manifest");
  const manifestResult = manifestSchema.safeParse(manifestInput);
  if (!manifestResult.success) {
    throw new CatalogLoadError(manifestResult.error.issues.map((issue) => ({
      code: "manifest_mismatch",
      field: issue.path.map(String).join(".") || "manifest",
      location: ["manifest", ...issue.path.map((part) => typeof part === "number" ? part : String(part))],
      message: issue.message,
      valueSummary: manifestValueSummary(manifestInput, issue.path),
    })));
  }
  const manifest = manifestResult.data;
  const issues: CatalogValidationIssue[] = [];
  if (new Set(manifest.files.map((file) => file.filename)).size !== PAYLOAD_FILENAMES.length) {
    issues.push({
      code: "manifest_mismatch", field: "files", location: ["manifest", "files"],
      message: "Manifest must record each of the four payload files exactly once",
      valueSummary: manifest.files.map((file) => file.filename).join(", "),
    });
  }
  const catalogEntryIndex = manifest.files.findIndex((file) => file.filename === CATALOG_FILENAME);
  const catalogEntry = manifest.files[catalogEntryIndex];
  const sha256 = createHash("sha256").update(catalogBytes).digest("hex");
  if (!catalogEntry) {
    issues.push({
      code: "manifest_mismatch", field: "files", location: ["manifest", "files"],
      message: "Manifest is missing the catalog file record", valueSummary: "missing",
    });
  } else {
    if (catalogEntry.sha256 !== sha256) {
      issues.push({
        code: "hash_mismatch", field: "sha256",
        location: ["manifest", "files", catalogEntryIndex, "sha256"],
        message: `Catalog SHA-256 does not match manifest value ${catalogEntry.sha256}`,
        valueSummary: sha256,
      });
    }
    if (catalogEntry.byteSize !== catalogBytes.length) {
      issues.push({
        code: "manifest_mismatch", field: "byteSize",
        location: ["manifest", "files", catalogEntryIndex, "byteSize"],
        message: `Catalog byte size does not match manifest value ${catalogEntry.byteSize}`,
        valueSummary: String(catalogBytes.length),
      });
    }
  }
  const result = validateWebinarStandardCatalog(parseJson(catalogBytes, "catalog"));
  if (!result.ok) {
    issues.push(...result.issues);
  } else {
    const actualUniqueCount = new Set(result.catalog.rules.map((rule) => rule.ruleId)).size;
    if (manifest.standardId !== result.catalog.standardId
      || manifest.standardVersion !== result.catalog.standardVersion
      || manifest.ruleCount !== result.catalog.rules.length
      || manifest.uniqueRuleIdCount !== actualUniqueCount) {
      issues.push({
        code: "manifest_mismatch", field: "catalog", location: ["manifest"],
        message: "Manifest identity or counts disagree with the validated catalog",
        valueSummary: `${result.catalog.standardId}/${result.catalog.standardVersion}: ${result.catalog.rules.length}/${actualUniqueCount}`,
      });
    }
  }
  if (issues.length > 0) throw new CatalogLoadError(issues);
  if (!result.ok) throw new CatalogLoadError(result.issues);
  return result.catalog;
}