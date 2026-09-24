import { createHash } from "node:crypto";

export interface ReleaseFingerprintInput {
  readonly standardId: string;
  readonly standardVersion: string;
  /** All five canonical repository paths, including manifest.json. */
  readonly canonicalDocuments: Readonly<Record<string, string>>;
  /** Captured actual implementation sources, not function names or rule IDs.
   * Include registry, evaluators and all transitive evaluation/contract helpers.
   * Capture once per application release, never from request payloads. */
  readonly evaluatorImplementation: Readonly<Record<string, string>>;
  readonly implementedRuleIds: readonly string[];
  readonly unimplementedRuleIds: readonly string[];
  readonly applicationRelease: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly foundationVersion: string | null;
  readonly taxonomyVersion: string | null;
  readonly calculatedAtEpochMs: number;
  readonly mode: "open-development";
}

const canonicalPaths = [
  "docs/standards/webinar/WEB-STANDARD-001.rules.json",
  "docs/standards/webinar/WEB-STANDARD-001.md",
  "docs/standards/webinar/WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md",
  "docs/standards/webinar/CHANGELOG-RC1.md",
  "docs/standards/webinar/manifest.json",
].sort();
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function requireValue(valid: boolean, message: string): asserts valid {
  if (!valid) throw new Error(`Invalid release fingerprint configuration: ${message}`);
}
function sortedRecord(values: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

/** Pure, versioned SHA-256 provenance contract. No clock, environment, Git or IO.
 * Callers persist this entire immutable value, not a mutable configuration reference.
 * This identity is not an approval, execution receipt, or operational readiness claim. */
export function createReleaseFingerprint(input: ReleaseFingerprintInput) {
  requireValue(!!input && input.mode === "open-development", "explicit open-development mode is required");
  requireValue(input.standardId === "WEB-STANDARD-001" && text(input.standardVersion)
    && /^\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.test(input.standardVersion), "effective standard and exact version are required");
  requireValue(text(input.applicationRelease) && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(input.applicationRelease), "full application commit is required");
  requireValue(Number.isSafeInteger(input.calculatedAtEpochMs) && input.calculatedAtEpochMs >= 0, "calculation instant is required");
  for (const value of [input.foundationVersion, input.taxonomyVersion]) {
    requireValue(value === null || text(value), "missing governed versions must be explicitly null");
  }
  requireValue(!!input.canonicalDocuments
    && JSON.stringify(Object.keys(input.canonicalDocuments).sort()) === JSON.stringify(canonicalPaths)
    && Object.values(input.canonicalDocuments).every(value => /^[0-9a-f]{64}$/.test(value)), "all five canonical SHA-256 hashes are required");
  requireValue(!!input.evaluatorImplementation && Object.keys(input.evaluatorImplementation).length > 0
    && Object.entries(input.evaluatorImplementation).every(([path, content]) => text(path) && text(content))
    && Object.keys(input.evaluatorImplementation).some(path => /(?:^|\/)registry\.ts$/.test(path)),
  "actual evaluator source contents including registry.ts are required");
  requireValue(Array.isArray(input.implementedRuleIds) && input.implementedRuleIds.length === 106
    && new Set(input.implementedRuleIds).size === 106
    && input.implementedRuleIds.every(id => /^WEB-[A-Z0-9-]+$/.test(id))
    && Array.isArray(input.unimplementedRuleIds) && input.unimplementedRuleIds.length === 0, "106 unique implemented rules and no missing rules are required");
  requireValue(!!input.dependencies && input.dependencies["@js-temporal/polyfill"] === "0.5.1"
    && Object.entries(input.dependencies).every(([name, version]) => text(name)
      && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)), "exact dependency versions including Temporal 0.5.1 are required");
  const implementationHashes = sortedRecord(Object.fromEntries(
    Object.entries(input.evaluatorImplementation).map(([path, content]) => [path, hash(content)]),
  ));
  const provenance = Object.freeze({
    schemaVersion: 1 as const,
    mode: input.mode,
    operational: false as const,
    standardId: input.standardId,
    standardVersion: input.standardVersion,
    canonicalDocuments: sortedRecord(input.canonicalDocuments),
    evaluatorRegistry: Object.freeze({
      digest: hash(JSON.stringify(implementationHashes)),
      implementationHashes,
      coverage: Object.freeze({
        implemented: 106, total: 106,
        implementedRuleIds: Object.freeze([...input.implementedRuleIds].sort()),
        unimplementedRuleIds: Object.freeze([] as string[]),
      }),
    }),
    applicationRelease: input.applicationRelease,
    dependencies: sortedRecord(input.dependencies),
    foundationVersion: input.foundationVersion,
    taxonomyVersion: input.taxonomyVersion,
    calculatedAtEpochMs: input.calculatedAtEpochMs,
  });
  return Object.freeze({ digest: hash(JSON.stringify(provenance)), provenance });
}

export type ReleaseFingerprint = ReturnType<typeof createReleaseFingerprint>;