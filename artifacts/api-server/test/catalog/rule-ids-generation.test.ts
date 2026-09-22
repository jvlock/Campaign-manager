import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RULE_IDS } from "../../src/lib/webinar-standard-catalog/rule-ids";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = "artifacts/api-server/src/lib/webinar-standard-catalog";
const generatorPath = join(repositoryRoot, directory, "generate-rule-ids.mjs");
const generatedRelativePath = `${directory}/rule-ids.generated.ts`;
const catalogRelativePath = "docs/standards/webinar/WEB-STANDARD-001.rules.json";
const manifestRelativePath = "docs/standards/webinar/manifest.json";

interface MutableCatalog {
  standardId: unknown;
  standardVersion: unknown;
  ruleCount: unknown;
  rules: Record<string, unknown>[];
}

interface MutableManifest {
  standardId: unknown;
  standardVersion: unknown;
  ruleCount: unknown;
  uniqueRuleIdCount: unknown;
  files: { filename: string; sha256: string; byteSize: number }[];
}

// Tests invoke only check mode. Temporary fixture edits never touch the checkout.
function check(root?: string) {
  return spawnSync(process.execPath, [
    generatorPath, "--check", ...(root === undefined ? [] : ["--repository-root", root]),
  ], { cwd: tmpdir(), encoding: "utf8" });
}

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "webinar-rule-id-check-"));
  try {
    for (const relativePath of [catalogRelativePath, manifestRelativePath, generatedRelativePath]) {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(repositoryRoot, relativePath), target);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function mutateSource(
  root: string,
  mutate: (catalog: MutableCatalog, manifest: MutableManifest) => void,
): Promise<void> {
  const catalog = JSON.parse(await readFile(join(root, catalogRelativePath), "utf8")) as MutableCatalog;
  const manifest = JSON.parse(await readFile(join(root, manifestRelativePath), "utf8")) as MutableManifest;
  mutate(catalog, manifest);
  const bytes = Buffer.from(JSON.stringify(catalog));
  const entry = manifest.files.find((file) => file.filename === catalogRelativePath);
  assert.ok(entry);
  entry.sha256 = createHash("sha256").update(bytes).digest("hex");
  entry.byteSize = bytes.length;
  await writeFile(join(root, catalogRelativePath), bytes);
  await writeFile(join(root, manifestRelativePath), JSON.stringify(manifest));
}

test("generator check-only mode matches the committed artifact byte-for-byte from a different cwd", async () => {
  const path = join(repositoryRoot, generatedRelativePath);
  const before = await readFile(path);
  const beforeStat = await stat(path);
  const result = check();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readFile(path), before);
  assert.equal((await stat(path)).mtimeMs, beforeStat.mtimeMs);
});

test("generated IDs contain exactly the canonical 106 IDs in source-array order", async () => {
  const source = JSON.parse(await readFile(join(repositoryRoot, catalogRelativePath), "utf8")) as MutableCatalog;
  const canonicalIds = source.rules.map((rule) => rule.ruleId);
  assert.equal(RULE_IDS.length, 106);
  assert.equal(new Set(RULE_IDS).size, 106);
  assert.deepEqual(new Set(RULE_IDS), new Set(canonicalIds));
  assert.deepEqual([...RULE_IDS], canonicalIds);
  assert.ok(Object.isFrozen(RULE_IDS));
  const shim = await readFile(join(repositoryRoot, directory, "rule-ids.ts"), "utf8");
  assert.equal(shim.trim(), 'export { RULE_IDS, type RuleId } from "./rule-ids.generated";');
});

test("check-only mode detects a single-byte drift without rewriting or leaving temporary files", async () => {
  await withRepository(async (root) => {
    const path = join(root, generatedRelativePath);
    const bytes = await readFile(path);
    bytes[0] = bytes[0] === 32 ? 33 : 32;
    await writeFile(path, bytes);
    const beforeStat = await stat(path);
    const beforeNames = await readdir(dirname(path));
    const result = check(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /RULE_IDS_DRIFT/);
    assert.deepEqual(await readFile(path), bytes);
    assert.equal((await stat(path)).mtimeMs, beforeStat.mtimeMs);
    assert.deepEqual(await readdir(dirname(path)), beforeNames);
  });
});

test("check-only mode reports a missing artifact without generating it", async () => {
  await withRepository(async (root) => {
    const path = join(root, generatedRelativePath);
    await rm(path);
    const result = check(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /RULE_IDS_DRIFT/);
    await assert.rejects(readFile(path), { code: "ENOENT" });
  });
});

test("generator rejects a raw source hash mismatch without touching the artifact", async () => {
  await withRepository(async (root) => {
    const output = join(root, generatedRelativePath);
    const before = await readFile(output);
    const path = join(root, catalogRelativePath);
    await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("\n")]));
    const result = check(root);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /hash|SHA.?256/i);
    assert.deepEqual(await readFile(output), before);
  });
});

test("generator source validation rejects a genuinely sparse in-memory rules array", () => {
  const code = `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { validateRuleIdSource } from ${JSON.stringify(pathToFileURL(generatorPath).href)};
    const bytes = await readFile(${JSON.stringify(join(repositoryRoot, catalogRelativePath))});
    const catalog = JSON.parse(bytes.toString("utf8"));
    const manifest = JSON.parse(await readFile(${JSON.stringify(join(repositoryRoot, manifestRelativePath))}, "utf8"));
    delete catalog.rules[0];
    assert.equal(catalog.rules.length, 106);
    assert.throws(() => validateRuleIdSource(catalog, manifest, bytes), /sparse at index 0/);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
    cwd: tmpdir(), encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

const invalidSources: readonly [
  string,
  (catalog: MutableCatalog, manifest: MutableManifest) => void,
][] = [
  ["catalog standard id", (catalog) => { catalog.standardId = "WEB-STANDARD-999"; }],
  ["catalog version", (catalog) => { catalog.standardVersion = "2.0"; }],
  ["manifest standard id", (_, manifest) => { manifest.standardId = "WEB-STANDARD-999"; }],
  ["manifest version", (_, manifest) => { manifest.standardVersion = "2.0"; }],
  ["catalog declared count", (catalog) => { catalog.ruleCount = 105; }],
  ["manifest count", (_, manifest) => { manifest.ruleCount = 105; }],
  ["manifest unique count", (_, manifest) => { manifest.uniqueRuleIdCount = 105; }],
  ["actual count", (catalog) => { catalog.rules.pop(); }],
  ["missing ID", (catalog) => { delete catalog.rules[0].ruleId; }],
  ["non-string ID", (catalog) => { catalog.rules[0].ruleId = 123; }],
  ["malformed ID", (catalog) => { catalog.rules[0].ruleId = "WEB-not-an-approved-format"; }],
  ["duplicate ID", (catalog) => { catalog.rules[1].ruleId = catalog.rules[0].ruleId; }],
  ["missing entry serialized as null", (catalog) => { delete catalog.rules[0]; }],
];

for (const [name, mutate] of invalidSources) {
  test(`generator rejects ${name} before any output write`, async () => {
    await withRepository(async (root) => {
      await mutateSource(root, mutate);
      const path = join(root, generatedRelativePath);
      const before = await readFile(path);
      const beforeStat = await stat(path);
      const beforeNames = await readdir(dirname(path));
      const result = check(root);
      assert.equal(result.status, 1, result.stderr);
      assert.doesNotMatch(result.stderr, /RULE_IDS_DRIFT/, "source validation must precede drift detection");
      assert.deepEqual(await readFile(path), before);
      assert.equal((await stat(path)).mtimeMs, beforeStat.mtimeMs);
      assert.deepEqual(await readdir(dirname(path)), beforeNames);
    });
  });
}