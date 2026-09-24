import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { loadWebinarStandardCatalog } from "./webinar-standard-catalog";
import { createReleaseFingerprint, createWebinarEvaluatorRegistry } from "./webinar-standard-evaluation";

const run = promisify(execFile);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const sorted = (values: Record<string, string>) => Object.freeze(Object.fromEntries(
  Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));

/** v1 is a build identity, not an evaluation-context digest or an operational approval.
 * A missing trustworthy Git commit is represented as null; never fabricate a commit. */
export function engineReleaseIdentity(input: {
  standardId: string; standardVersion: string; canonicalDocuments: Record<string, string>;
  evaluatorImplementation: Record<string, string>; implementedRuleIds: readonly string[];
  applicationRelease: string | null; dependencies: Record<string, string>;
}) {
  const implementationHashes = sorted(Object.fromEntries(Object.entries(input.evaluatorImplementation)
    .map(([path, content]) => [path, sha256(content)])));
  const provenance = Object.freeze({
    schemaVersion: 1 as const, mode: "open-development" as const, operational: false as const,
    standardId: input.standardId, standardVersion: input.standardVersion,
    canonicalDocuments: sorted(input.canonicalDocuments),
    evaluatorRegistry: Object.freeze({
      digest: sha256(JSON.stringify(implementationHashes)),
      implementationHashes,
      coverage: Object.freeze({
        implemented: input.implementedRuleIds.length, total: input.implementedRuleIds.length,
        implementedRuleIds: Object.freeze([...input.implementedRuleIds].sort()),
        unimplementedRuleIds: Object.freeze([] as string[]),
      }),
    }),
    applicationRelease: input.applicationRelease,
    dependencies: sorted(input.dependencies),
  });
  return Object.freeze({ digest: sha256(JSON.stringify(provenance)), provenance });
}
/** Stable in both source execution and relocated esbuild bundles. Never caller supplied. */
export function resolveWebinarRepositoryRoot() {
  let root = resolve(process.cwd());
  while (!existsSync(join(root, "pnpm-workspace.yaml"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Release provenance requires the application workspace");
    root = parent;
  }
  return root;
}

/** No caller-provided hashes, source bytes, versions, dependency claims or release identities. */
export async function captureWebinarRelease(calculatedAtEpochMs: number,
  testOnlyCommitReader?: () => Promise<string>) {
  if (testOnlyCommitReader && process.env.NODE_ENV !== "test") {
    throw new Error("Release capture does not accept caller-provided build identities");
  }
  const root = resolveWebinarRepositoryRoot();
  const canonicalDocuments: Record<string, string> = {};
  for (const filename of ["WEB-STANDARD-001.rules.json", "WEB-STANDARD-001.md", "WEBINAR-PILOT-IMPLEMENTATION-AUTHORIZATION.md", "CHANGELOG-RC1.md", "manifest.json"]) {
    const path = `docs/standards/webinar/${filename}`;
    canonicalDocuments[path] = createHash("sha256").update(await readFile(join(root, path))).digest("hex");
  }
  const catalog = await loadWebinarStandardCatalog({ repositoryRoot: root });
  const registry = createWebinarEvaluatorRegistry(catalog);
  const evaluatorImplementation: Record<string, string> = {};
  const lib = join(root, "artifacts/api-server/src/lib");
  // Hash the complete engine implementation and its policy helpers, not just the registry list.
  for (const directory of (await readdir(lib, { withFileTypes: true })).filter(entry => entry.isDirectory() && (entry.name.startsWith("webinar-standard-") || entry.name === "webinar-domain-adapters"))) {
    for (const file of (await readdir(join(lib, directory.name))).filter(name => name.endsWith(".ts")).sort()) {
      const path = join(lib, directory.name, file);
      evaluatorImplementation[relative(root, path)] = await readFile(path, "utf8");
    }
  }
  // The trusted capture boundary itself affects effective release identity.
  for (const filename of ["webinar-release-provenance.ts", "webinar-persistence.ts", "webinar-simulation-snapshot.ts", "webinar-evaluation-orchestration.ts", "webinar-evaluation-sources.ts", "webinar-participant-lifecycle.ts", "webinar-foundation.ts", "webinar-foundation-service.ts"]) {
    const path = join(lib, filename);
    evaluatorImplementation[relative(root, path)] = await readFile(path, "utf8");
  }
  let applicationRelease: string | null = null;
  try {
    const commit = testOnlyCommitReader
      ? await testOnlyCommitReader()
      : (await run("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, timeout: 5000, maxBuffer: 1024 })).stdout;
    if (/^[a-f0-9]{40}$/.test(commit.trim())) applicationRelease = commit.trim();
  } catch { /* The build identity is unavailable, not a fabricated replacement. */ }
  const require = createRequire(join(root, "artifacts/api-server/package.json"));
  const dependencies: Record<string, string> = { node: process.versions.node };
  for (const name of ["@js-temporal/polyfill", "zod", "drizzle-orm"]) {
    let directory = dirname(require.resolve(name));
    for (;;) {
      const manifest = join(directory, "package.json");
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, "utf8"));
        if (pkg.name === name) { dependencies[name] = pkg.version; break; }
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`Cannot determine installed dependency version: ${name}`);
      directory = parent;
    }
  }
  const declared = JSON.parse(await readFile(join(root, "artifacts/api-server/package.json"), "utf8"));
  if (declared.dependencies["@js-temporal/polyfill"] !== dependencies["@js-temporal/polyfill"]) {
    throw new Error("Temporal exact dependency pin does not match the installed release");
  }
  const captured = {
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, canonicalDocuments,
    evaluatorImplementation, implementedRuleIds: registry.implementedRuleIds, unimplementedRuleIds: registry.unimplementedRuleIds,
    dependencies, foundationVersion: null, taxonomyVersion: null,
    calculatedAtEpochMs, mode: "open-development",
  } as const;
  const engineRelease = engineReleaseIdentity({ ...captured, applicationRelease });
  if (applicationRelease) {
    // Preserve the accepted v1 digest and provenance byte-for-byte. Old receipts
    // and snapshots continue to compare against precisely the same as-of digest.
    return { ...createReleaseFingerprint({ ...captured, applicationRelease }),
      engineReleaseFingerprint: engineRelease.digest, engineRelease };
  }
  // A genuinely unidentifiable build uses an explicit v2 legacy/context envelope.
  // Never write a v1 digest with a fake commit. The stable engine identity still
  // records which *source and dependency bytes* were captured.
  const provenance = { ...engineRelease.provenance, schemaVersion: 2 as const,
    foundationVersion: null, taxonomyVersion: null, calculatedAtEpochMs };
  return { digest: sha256(JSON.stringify(provenance)), provenance,
    engineReleaseFingerprint: engineRelease.digest, engineRelease };
}