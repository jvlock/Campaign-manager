import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReleaseFingerprint, type ReleaseFingerprintInput } from "../../src/lib/webinar-standard-evaluation/release-fingerprint";
import { catalog, registry, referenceTime } from "./fixtures";

const root = new URL("../../../../", import.meta.url);
const canonicalDirectory = new URL("docs/standards/webinar/", root);
const canonicalDocuments = Object.fromEntries(await Promise.all([
  "WEB-STANDARD-001.rules.json", "WEB-STANDARD-001.md",
  "WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md", "CHANGELOG-RC1.md", "manifest.json",
].map(async name => [`docs/standards/webinar/${name}`,
  createHash("sha256").update(await readFile(new URL(name, canonicalDirectory))).digest("hex")])));
const directory = new URL("../../src/lib/webinar-standard-evaluation/", import.meta.url);
const evaluatorImplementation = Object.fromEntries(await Promise.all(
  (await readdir(directory)).filter(name => name.endsWith(".ts")).map(async name =>
    [name, await readFile(new URL(name, directory), "utf8")]),
));
const fixture = (): ReleaseFingerprintInput => ({
  standardId: catalog.standardId, standardVersion: catalog.standardVersion,
  canonicalDocuments: { ...canonicalDocuments }, evaluatorImplementation: { ...evaluatorImplementation },
  implementedRuleIds: [...registry.implementedRuleIds], unimplementedRuleIds: [],
  applicationRelease: execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(root), encoding: "utf8" }).trim(),
  dependencies: { "@js-temporal/polyfill": "0.5.1" },
  foundationVersion: null, taxonomyVersion: null,
  calculatedAtEpochMs: referenceTime, mode: "open-development",
});

test("release identity is deterministic, ordered, immutable and explicitly nonoperational", () => {
  const input = fixture();
  const result = createReleaseFingerprint(input);
  const reverse = (record: Readonly<Record<string, string>>) => Object.fromEntries(Object.entries(record).reverse());
  assert.deepEqual(createReleaseFingerprint({
    ...input, canonicalDocuments: reverse(input.canonicalDocuments),
    evaluatorImplementation: reverse(input.evaluatorImplementation),
    implementedRuleIds: [...input.implementedRuleIds].reverse(),
  }), result);
  assert.equal(result.provenance.operational, false);
  assert.equal(result.provenance.foundationVersion, null);
  assert.equal(result.provenance.taxonomyVersion, null);
  assert.equal(result.provenance.evaluatorRegistry.coverage.implemented, 106);
  assert.ok(Object.isFrozen(result.provenance.evaluatorRegistry.implementationHashes));
  assert.ok(Object.isFrozen(result.provenance.evaluatorRegistry.coverage.implementedRuleIds));
  (input.canonicalDocuments as Record<string, string>)[Object.keys(canonicalDocuments)[0]!] = "0".repeat(64);
  assert.notDeepEqual(input.canonicalDocuments, result.provenance.canonicalDocuments);
});

test("all release-affecting values change identity with unchanged rule IDs", () => {
  const input = fixture();
  const original = createReleaseFingerprint(input).digest;
  const variants: Partial<ReleaseFingerprintInput>[] = [
    { standardVersion: "2.0.0" },
    { applicationRelease: "0".repeat(40) },
    { calculatedAtEpochMs: referenceTime + 1 },
    { foundationVersion: "foundation-release-2" },
    { taxonomyVersion: "taxonomy-release-2" },
    { dependencies: { ...input.dependencies, "other-dependency": "1.0.1" } },
    { evaluatorImplementation: { ...input.evaluatorImplementation, "registry.ts": input.evaluatorImplementation["registry.ts"] + "\n// changed implementation\n" } },
    { canonicalDocuments: { ...input.canonicalDocuments, [Object.keys(canonicalDocuments)[0]!]: "0".repeat(64) } },
  ];
  for (const variant of variants) assert.notEqual(createReleaseFingerprint({ ...input, ...variant }).digest, original);
});

test("missing or ambiguous release configuration fails closed", () => {
  const input = fixture();
  for (const key of Object.keys(input)) {
    const invalid = { ...input };
    delete (invalid as unknown as Record<string, unknown>)[key];
    assert.throws(() => createReleaseFingerprint(invalid), /Invalid release fingerprint configuration/);
  }
  for (const variant of [
    { dependencies: { "@js-temporal/polyfill": "^0.5.1" } },
    { canonicalDocuments: {} }, { evaluatorImplementation: {} },
    { implementedRuleIds: input.implementedRuleIds.slice(1) },
    { applicationRelease: "HEAD" }, { standardVersion: "latest" },
  ]) assert.throws(() => createReleaseFingerprint({ ...input, ...variant }), /Invalid release fingerprint configuration/);
});