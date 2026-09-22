import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

// CLI: node <absolute script path> --check|--generate [--repository-root <absolute path>]
// Ordering contract: retain exactly the order of IDs in the canonical rules array.
// Normal tests use --check only; --generate is an explicit maintenance action.
const SOURCE_PATH = "docs/standards/webinar/WEB-STANDARD-001.rules.json";
const MANIFEST_PATH = "docs/standards/webinar/manifest.json";
const GENERATOR_PATH = "artifacts/api-server/src/lib/webinar-standard-catalog/generate-rule-ids.mjs";
const OUTPUT_PATH = "artifacts/api-server/src/lib/webinar-standard-catalog/rule-ids.generated.ts";
const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const RULE_COUNT = 106;
const RULE_ID_PATTERN = /^WEB-(?:[A-Z]+-)+(?:[0-9]{3}|C[0-9]{2})$/;

function requireValid(condition, message) {
  if (!condition) {
    throw new Error(`RULE_IDS_SOURCE_INVALID: ${message}`);
  }
}

/**
 * Pure validation seam for callers, including sparse-array tests.
 * catalogBytes must be the original Buffer or Uint8Array, not reserialized JSON.
 * Returns a fresh array of IDs in source order; never mutates its inputs.
 */
export function validateRuleIdSource(catalog, manifest, catalogBytes) {
  requireValid(catalogBytes instanceof Uint8Array, "catalogBytes must contain raw source bytes");
  for (const [label, value] of [["catalog", catalog], ["manifest", manifest]]) {
    requireValid(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
    requireValid(value.standardId === "WEB-STANDARD-001", `${label}.standardId must be WEB-STANDARD-001`);
    requireValid(value.standardVersion === "1.0-pilot-rc1", `${label}.standardVersion must be 1.0-pilot-rc1`);
    requireValid(value.ruleCount === RULE_COUNT, `${label}.ruleCount must be ${RULE_COUNT}`);
  }
  requireValid(manifest.uniqueRuleIdCount === RULE_COUNT, `manifest.uniqueRuleIdCount must be ${RULE_COUNT}`);
  requireValid(Array.isArray(manifest.files), "manifest.files must be an array");
  const entries = manifest.files.filter((entry) => entry?.filename === SOURCE_PATH);
  requireValid(entries.length === 1, `manifest must contain exactly one catalog entry for ${SOURCE_PATH}`);
  const hash = createHash("sha256").update(catalogBytes).digest("hex");
  requireValid(entries[0].sha256 === hash, `raw SHA-256 mismatch for ${SOURCE_PATH}`);
  requireValid(Array.isArray(catalog.rules) && catalog.rules.length === RULE_COUNT, `catalog.rules must contain exactly ${RULE_COUNT} rules`);

  const ids = [];
  const seen = new Set();
  for (let index = 0; index < RULE_COUNT; index += 1) {
    requireValid(Object.hasOwn(catalog.rules, index), `catalog.rules is sparse at index ${index}`);
    const rule = catalog.rules[index];
    requireValid(rule !== null && typeof rule === "object" && !Array.isArray(rule), `catalog.rules[${index}] must be an object`);
    requireValid(Object.hasOwn(rule, "ruleId"), `catalog.rules[${index}] must own ruleId`);
    requireValid(typeof rule.ruleId === "string" && RULE_ID_PATTERN.test(rule.ruleId), `invalid ruleId at catalog.rules[${index}]`);
    requireValid(!seen.has(rule.ruleId), `duplicate ruleId ${rule.ruleId}`);
    seen.add(rule.ruleId);
    ids.push(rule.ruleId);
  }
  requireValid(seen.size === RULE_COUNT, `expected ${RULE_COUNT} unique rule IDs`);
  return ids;
}

function renderRuleIds(ids) {
  return Buffer.from([
    "/**",
    " * GENERATED FILE — DO NOT EDIT.",
    ` * Source: ${SOURCE_PATH}`,
    ` * Generator: ${GENERATOR_PATH}`,
    " * Ordering: identical to the canonical JSON rules array.",
    " * Identifiers only; rule content is owned by the committed JSON catalog.",
    " */",
    "export const RULE_IDS = Object.freeze([",
    ...ids.map((id) => `  ${JSON.stringify(id)},`),
    "] as const);",
    "",
    "export type RuleId = (typeof RULE_IDS)[number];",
    "",
  ].join("\n"), "utf8");
}

function driftError(outputPath, offset, detail) {
  const error = new Error(`RULE_IDS_DRIFT: ${outputPath}; first differing byte at offset ${offset} (zero-based); ${detail}`);
  error.code = "RULE_IDS_DRIFT";
  return error;
}

export async function runRuleIdGenerator({ mode, repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  if (mode !== "generate" && mode !== "check") {
    throw new Error("RULE_IDS_ARGUMENT: mode must be 'generate' or 'check'");
  }
  if (typeof repositoryRoot !== "string" || !isAbsolute(repositoryRoot)) {
    throw new Error("RULE_IDS_ARGUMENT: repositoryRoot must be an absolute path");
  }
  const catalogBytes = await readFile(join(repositoryRoot, SOURCE_PATH));
  const manifestBytes = await readFile(join(repositoryRoot, MANIFEST_PATH));
  const ids = validateRuleIdSource(
    JSON.parse(catalogBytes.toString("utf8")),
    JSON.parse(manifestBytes.toString("utf8")),
    catalogBytes,
  );
  const expected = renderRuleIds(ids);
  const outputPath = join(repositoryRoot, OUTPUT_PATH);

  if (mode === "check") {
    let actual;
    try {
      actual = await readFile(outputPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw driftError(outputPath, 0, "generated file is missing");
      }
      throw error;
    }
    if (!actual.equals(expected)) {
      let offset = 0;
      while (offset < Math.min(actual.length, expected.length) && actual[offset] === expected[offset]) {
        offset += 1;
      }
      throw driftError(outputPath, offset, `expected ${expected.length} bytes, found ${actual.length}`);
    }
  } else {
    // Validation and rendering must finish before any filesystem mutation.
    await mkdir(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
    let handle;
    let created = false;
    try {
      handle = await open(temporaryPath, "wx", 0o644);
      created = true;
      await handle.writeFile(expected);
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, outputPath);
    } finally {
      try {
        if (handle) await handle.close();
      } finally {
        if (created) {
          await unlink(temporaryPath).catch((error) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      }
    }
  }
  return { mode, ruleCount: ids.length, outputPath };
}

function parseArguments(args) {
  let mode;
  let repositoryRoot;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--check" || argument === "--generate") {
      if (mode !== undefined) throw new Error("RULE_IDS_ARGUMENT: exactly one mode is required");
      mode = argument.slice(2);
    } else if (argument === "--repository-root") {
      if (repositoryRoot !== undefined || index + 1 >= args.length || !isAbsolute(args[index + 1])) {
        throw new Error("RULE_IDS_ARGUMENT: --repository-root requires one absolute path");
      }
      repositoryRoot = args[++index];
    } else {
      throw new Error(`RULE_IDS_ARGUMENT: unknown argument ${argument}`);
    }
  }
  if (mode === undefined) throw new Error("RULE_IDS_ARGUMENT: exactly one of --check or --generate is required");
  return { mode, repositoryRoot };
}

// Node supplies an absolute argv[1]; do not resolve relative paths against cwd.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runRuleIdGenerator(parseArguments(process.argv.slice(2)));
    console.log(`RULE_IDS_OK: ${result.mode}; ${result.ruleCount} rules; ${result.outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}