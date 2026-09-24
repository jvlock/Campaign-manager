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
export async function captureWebinarRelease(calculatedAtEpochMs: number) {
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
  for (const filename of ["webinar-release-provenance.ts", "webinar-persistence.ts", "webinar-simulation-snapshot.ts", "webinar-evaluation-orchestration.ts", "webinar-evaluation-sources.ts", "webinar-participant-lifecycle.ts"]) {
    const path = join(lib, filename);
    evaluatorImplementation[relative(root, path)] = await readFile(path, "utf8");
  }
  const { stdout } = await run("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, timeout: 5000, maxBuffer: 1024 });
  const applicationRelease = stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(applicationRelease)) throw new Error("Exact application commit unavailable");
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
  return createReleaseFingerprint({
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, canonicalDocuments,
    evaluatorImplementation, implementedRuleIds: registry.implementedRuleIds, unimplementedRuleIds: registry.unimplementedRuleIds,
    applicationRelease, dependencies, foundationVersion: null, taxonomyVersion: null,
    calculatedAtEpochMs, mode: "open-development",
  });
}