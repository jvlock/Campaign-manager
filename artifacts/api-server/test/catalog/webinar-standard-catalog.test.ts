import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CatalogLoadError,
  EVIDENCE_BASES,
  HIERARCHY_LEVELS,
  PRIMARY_RULE_TYPES,
  READINESS_STAGES,
  REQUIRED_RULE_FIELDS,
  RULE_COUNT,
  STANDARD_ID,
  STANDARD_VERSION,
  VALIDATION_METHODS,
  loadWebinarStandardCatalog,
  resolveWebinarStandardCatalogPaths,
  validateWebinarStandardCatalog,
  type CatalogValidationIssue,
  type RuleId,
  type WebinarStandardCatalog,
} from "../../src/lib/webinar-standard-catalog/index";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const catalogRelativePath = "docs/standards/webinar/WEB-STANDARD-001.rules.json";
const manifestRelativePath = "docs/standards/webinar/manifest.json";
const catalogBytes = await readFile(join(repositoryRoot, catalogRelativePath));
// Parsed input deliberately has mutable/unknown rule properties: these are validation inputs,
// not an alternative hand-maintained definition of the approved catalog.
type InputCatalog = Record<string, unknown> & {
  rules: Record<string, unknown>[];
  requiredFields: string[];
  ruleCount: number;
};
const approved = JSON.parse(catalogBytes.toString("utf8")) as InputCatalog;
const approvedManifest = JSON.parse(await readFile(join(repositoryRoot, manifestRelativePath), "utf8"));

function smallFixture(count: 1 | 2 = 1): InputCatalog {
  return {
    ...approved,
    requiredFields: [...approved.requiredFields],
    ruleCount: count,
    rules: Array.from({ length: count }, () => ({ ...approved.rules[0] })),
  };
}

function issuesFor(input: unknown): readonly CatalogValidationIssue[] {
  const result = validateWebinarStandardCatalog(input);
  assert.equal(result.ok, false, "invalid input must not produce a catalog");
  if (result.ok) throw new Error("Expected validation issues");
  assert.ok(result.issues.length > 0);
  for (const issue of result.issues) {
    assert.equal(typeof issue.field, "string");
    assert.ok(issue.message.length > 0);
    assert.equal(typeof issue.valueSummary, "string");
    assert.ok(issue.valueSummary.length > 0);
    assert.ok(Array.isArray(issue.location));
  }
  return result.issues;
}

function expectIssue(
  issues: readonly CatalogValidationIssue[],
  code: CatalogValidationIssue["code"],
  field: string,
  location: readonly (string | number)[],
  ruleId?: string,
): CatalogValidationIssue {
  const issue = issues.find((entry) =>
    entry.code === code && entry.field === field &&
    JSON.stringify(entry.location) === JSON.stringify(location));
  assert.ok(issue, `Expected ${code} at ${JSON.stringify(location)}; got ${JSON.stringify(issues)}`);
  if (ruleId !== undefined) assert.equal(issue.ruleId, ruleId);
  if (location[0] === "rules" && typeof location[1] === "number") {
    assert.equal(issue.ruleIndex, location[1]);
  }
  return issue;
}

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "webinar-standard-catalog-"));
  try {
    await mkdir(dirname(join(root, catalogRelativePath)), { recursive: true });
    await copyFile(join(repositoryRoot, catalogRelativePath), join(root, catalogRelativePath));
    await copyFile(join(repositoryRoot, manifestRelativePath), join(root, manifestRelativePath));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function expectLoadError(root: string, code: CatalogValidationIssue["code"]): Promise<void> {
  await assert.rejects(loadWebinarStandardCatalog({ repositoryRoot: root }), (error: unknown) => {
    assert.ok(error instanceof CatalogLoadError);
    assert.ok(error.issues.some((issue) => issue.code === code), JSON.stringify(error.issues));
    for (const issue of error.issues) {
      assert.ok(issue.message.length > 0);
      assert.equal(typeof issue.field, "string");
      assert.equal(typeof issue.valueSummary, "string");
      assert.ok(Array.isArray(issue.location));
    }
    return true;
  });
}

test("loads the complete approved catalog with identity, properties, enums, and manifest hash", async () => {
  const catalog = await loadWebinarStandardCatalog();
  assert.equal(STANDARD_ID, "WEB-STANDARD-001");
  assert.equal(STANDARD_VERSION, "1.0-pilot-rc1");
  assert.equal(RULE_COUNT, 106);
  assert.equal(catalog.standardId, STANDARD_ID);
  assert.equal(catalog.standardVersion, STANDARD_VERSION);
  assert.equal(catalog.ruleCount, 106);
  assert.equal(catalog.rules.length, 106);
  assert.equal(new Set(catalog.rules.map((rule) => rule.ruleId)).size, 106);
  assert.deepEqual(catalog, approved);
  assert.deepEqual(catalog.requiredFields, REQUIRED_RULE_FIELDS);
  assert.equal(REQUIRED_RULE_FIELDS.length, 12);
  for (const rule of catalog.rules) {
    for (const field of REQUIRED_RULE_FIELDS) {
      assert.ok(Object.hasOwn(rule, field), `${rule.ruleId}.${field}`);
      assert.notEqual(rule[field], null);
      assert.notEqual(rule[field], undefined);
    }
    assert.ok(HIERARCHY_LEVELS.includes(rule.hierarchyLevel));
    assert.ok(PRIMARY_RULE_TYPES.includes(rule.primaryRuleType));
    assert.ok(EVIDENCE_BASES.includes(rule.evidenceBasis));
    assert.ok(READINESS_STAGES.includes(rule.readinessStage));
    assert.ok(VALIDATION_METHODS.includes(rule.validationMethod));
    assert.equal(typeof rule.exceptionEligible, "boolean");
  }
  const record = approvedManifest.files.find((file: { filename: string }) => file.filename === catalogRelativePath);
  assert.ok(record);
  assert.equal(createHash("sha256").update(catalogBytes).digest("hex"), record.sha256);
  assert.equal(catalogBytes.length, record.byteSize);
  assert.equal(approvedManifest.standardId, catalog.standardId);
  assert.equal(approvedManifest.standardVersion, catalog.standardVersion);
  assert.equal(approvedManifest.packageRevision, "RC1.1");
});

test("preserves supplemental null and non-null exception notes without interpreting them", async () => {
  const catalog = await loadWebinarStandardCatalog();
  assert.equal(catalog.rules.find((rule) => rule.ruleId === "WEB-SETUP-001")?.exceptionEligibleNote, null);
  const rule = catalog.rules.find((entry) => entry.ruleId === "WEB-QA-005");
  assert.ok(rule);
  assert.equal(rule.exceptionEligibleNote, "via documented dependency only");
  assert.equal(rule.exceptionEligible, false);
});

test("repeated loads are equivalent but independently allocated and recursively frozen", async () => {
  const first = await loadWebinarStandardCatalog();
  const second = await loadWebinarStandardCatalog();
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.rules, second.rules);
  assert.notEqual(first.requiredFields, second.requiredFields);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.rules));
  assert.ok(Object.isFrozen(first.requiredFields));
  first.rules.forEach((rule, index) => {
    assert.ok(Object.isFrozen(rule));
    assert.notEqual(rule, second.rules[index]);
  });
  assert.throws(() => Object.assign(first, { note: "changed" }), TypeError);
  assert.throws(() => Object.assign(first.rules[0]!, { ruleName: "changed" }), TypeError);
  assert.throws(() => Array.prototype.pop.call(first.rules), TypeError);
  assert.throws(() => Array.prototype.pop.call(first.requiredFields), TypeError);
  assert.deepEqual(first, second);
});

test("pure validation defensively copies without freezing or changing caller-owned input", () => {
  const input = JSON.parse(catalogBytes.toString("utf8")) as InputCatalog;
  const result = validateWebinarStandardCatalog(input);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  assert.deepEqual(input, approved);
  assert.notEqual(result.catalog, input);
  assert.notEqual(result.catalog.rules, input.rules);
  assert.notEqual(result.catalog.requiredFields, input.requiredFields);
  input.rules.forEach((rule, index) => {
    assert.equal(Object.isFrozen(rule), false);
    assert.notEqual(result.catalog.rules[index], rule);
  });
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.rules), false);
  assert.equal(Object.isFrozen(input.requiredFields), false);
  input.rules[0]!.ruleName = "changed by caller";
  input.requiredFields.pop();
  input.rules.pop();
  assert.deepEqual(result.catalog, approved);
});

// Type-only assertions: never execute writes to the production result.
function readonlyContract(catalog: WebinarStandardCatalog): void {
  // @ts-expect-error Catalog metadata is readonly.
  catalog.note = "changed";
  // @ts-expect-error Rules are a readonly array.
  catalog.rules.pop();
  // @ts-expect-error Rule properties are readonly.
  catalog.rules[0]!.ruleName = "changed";
  // @ts-expect-error Required fields are a readonly array.
  catalog.requiredFields.pop();
  const approvedId: RuleId = "WEB-SETUP-001";
  void approvedId;
  // @ts-expect-error Arbitrary strings are not approved stable rule IDs.
  const invalidId: RuleId = "not-a-rule";
  void invalidId;
}
void readonlyContract;

test("resolves default and absolute override paths without depending on cwd", async () => {
  const paths = resolveWebinarStandardCatalogPaths();
  assert.equal(paths.catalogPath, join(repositoryRoot, catalogRelativePath));
  assert.equal(paths.manifestPath, join(repositoryRoot, manifestRelativePath));
  assert.ok(isAbsolute(paths.repositoryRoot));
  await withRepository(async (root) => {
    assert.deepEqual(resolveWebinarStandardCatalogPaths(root), {
      repositoryRoot: root,
      catalogPath: join(root, catalogRelativePath),
      manifestPath: join(root, manifestRelativePath),
    });
    assert.deepEqual(await loadWebinarStandardCatalog({ repositoryRoot: root }), approved);
  });
});

test("rejects relative repository root overrides", async () => {
  assert.throws(() => resolveWebinarStandardCatalogPaths("relative/root"));
  await assert.rejects(loadWebinarStandardCatalog({ repositoryRoot: "relative/root" }));
});

test("reports a missing required rule property", () => {
  const input = smallFixture();
  delete input.rules[0]!.trigger;
  expectIssue(issuesFor(input), "missing_field", "trigger", ["rules", 0, "trigger"], "WEB-SETUP-001");
});

test("reports a null required rule property", () => {
  const input = smallFixture();
  input.rules[0]!.trigger = null;
  expectIssue(issuesFor(input), "invalid_type", "trigger", ["rules", 0, "trigger"], "WEB-SETUP-001");
});

test("reports a duplicate stable rule ID at the duplicate rule", () => {
  expectIssue(issuesFor(smallFixture(2)), "duplicate_rule_id", "ruleId", ["rules", 1, "ruleId"], "WEB-SETUP-001");
});

for (const field of ["primaryRuleType", "hierarchyLevel", "readinessStage", "validationMethod", "evidenceBasis"]) {
  test(`rejects an invalid ${field} enumeration`, () => {
    const input = smallFixture();
    input.rules[0]![field] = "not-an-approved-enumeration";
    expectIssue(issuesFor(input), "invalid_enum", field, ["rules", 0, field], "WEB-SETUP-001");
  });
}

test("rejects non-boolean exception eligibility", () => {
  const input = smallFixture();
  input.rules[0]!.exceptionEligible = "false";
  expectIssue(issuesFor(input), "invalid_type", "exceptionEligible", ["rules", 0, "exceptionEligible"], "WEB-SETUP-001");
});

test("rejects a wrong rule count even when metadata matches the small array", () => {
  expectIssue(issuesFor(smallFixture()), "invalid_rule_count", "ruleCount", ["ruleCount"]);
});

for (const field of ["standardId", "standardVersion"]) {
  test(`rejects an incorrect catalog ${field}`, () => {
    const input = smallFixture();
    input[field] = "incorrect";
    expectIssue(issuesFor(input), "invalid_value", field, [field]);
  });
}

test("rejects unknown root schema drift", () => {
  const input = smallFixture();
  input.unapprovedField = true;
  expectIssue(issuesFor(input), "unknown_field", "unapprovedField", ["unapprovedField"]);
});

test("rejects unknown rule schema drift", () => {
  const input = smallFixture();
  input.rules[0]!.unapprovedField = true;
  expectIssue(issuesFor(input), "unknown_field", "unapprovedField", ["rules", 0, "unapprovedField"], "WEB-SETUP-001");
});

test("rejects placeholder required text", () => {
  const input = smallFixture();
  input.rules[0]!.resolutionGuidance = "TBD";
  expectIssue(issuesFor(input), "placeholder", "resolutionGuidance", ["rules", 0, "resolutionGuidance"], "WEB-SETUP-001");
});

test("reports a missing stable rule ID", () => {
  const input = smallFixture();
  delete input.rules[0]!.ruleId;
  expectIssue(issuesFor(input), "missing_field", "ruleId", ["rules", 0, "ruleId"]);
});

test("rejects an invalid stable rule ID", () => {
  const input = smallFixture();
  input.rules[0]!.ruleId = "not-a-rule";
  expectIssue(issuesFor(input), "invalid_rule_id", "ruleId", ["rules", 0, "ruleId"]);
});

test("collects multiple independent errors across two rules in one validation result", () => {
  const input = smallFixture(2);
  delete input.rules[0]!.trigger;
  input.rules[0]!.exceptionEligible = "false";
  input.rules[1]!.primaryRuleType = "not-an-approved-enumeration";
  input.rules[1]!.resolutionGuidance = "TBD";
  const issues = issuesFor(input);
  expectIssue(issues, "invalid_rule_count", "ruleCount", ["ruleCount"]);
  expectIssue(issues, "missing_field", "trigger", ["rules", 0, "trigger"], "WEB-SETUP-001");
  expectIssue(issues, "invalid_type", "exceptionEligible", ["rules", 0, "exceptionEligible"], "WEB-SETUP-001");
  expectIssue(issues, "duplicate_rule_id", "ruleId", ["rules", 1, "ruleId"], "WEB-SETUP-001");
  expectIssue(issues, "invalid_enum", "primaryRuleType", ["rules", 1, "primaryRuleType"], "WEB-SETUP-001");
  expectIssue(issues, "placeholder", "resolutionGuidance", ["rules", 1, "resolutionGuidance"], "WEB-SETUP-001");
});

test("rejects raw catalog hash mismatch independently of semantic JSON content", async () => {
  await withRepository(async (root) => {
    // Preserve byte count and parsed content, changing only one whitespace byte.
    const changed = Buffer.from(catalogBytes);
    const index = changed.indexOf(0x0a);
    assert.ok(index >= 0);
    changed[index] = 0x20;
    assert.deepEqual(JSON.parse(changed.toString("utf8")), approved);
    await writeFile(join(root, catalogRelativePath), changed);
    await expectLoadError(root, "hash_mismatch");
  });
});

const manifestFailures: readonly [string, unknown][] = [
  ["schemaVersion", "2.0"],
  ["standardId", "WEB-STANDARD-999"],
  ["standardVersion", "1.0"],
  ["packageRevision", "RC1"],
  ["ruleCount", 105],
  ["uniqueRuleIdCount", 105],
  ["duplicateRuleIdCount", 1],
  ["nullRequiredFieldCount", 1],
  ["placeholderTermCount", 1],
  ["invalidEnumerationCount", 1],
  ["nonBooleanExceptionEligibleCount", 1],
  ["semanticValidationCount", 13],
  ["semanticValidationPassedCount", 13],
  ["semanticValidationFailedCount", 1],
];

for (const [field, value] of manifestFailures) {
  test(`rejects manifest ${field} mismatch`, async () => {
    await withRepository(async (root) => {
      const manifest = structuredClone(approvedManifest);
      manifest[field] = value;
      await writeFile(join(root, manifestRelativePath), JSON.stringify(manifest));
      await expectLoadError(root, "manifest_mismatch");
    });
  });
}

test("rejects unknown manifest schema drift", async () => {
  await withRepository(async (root) => {
    await writeFile(join(root, manifestRelativePath), JSON.stringify({ ...approvedManifest, unapprovedField: true }));
    await expectLoadError(root, "manifest_mismatch");
  });
});

for (const relativePath of [catalogRelativePath, manifestRelativePath]) {
  test(`reports malformed JSON in ${relativePath}`, async () => {
    await withRepository(async (root) => {
      const malformed = Buffer.from("{ invalid JSON");
      await writeFile(join(root, relativePath), malformed);
      if (relativePath === catalogRelativePath) {
        // Keep integrity metadata correct to isolate parsing from hash validation.
        const manifest = structuredClone(approvedManifest);
        const record = manifest.files.find((file: { filename: string }) => file.filename === catalogRelativePath);
        record.sha256 = createHash("sha256").update(malformed).digest("hex");
        record.byteSize = malformed.length;
        await writeFile(join(root, manifestRelativePath), JSON.stringify(manifest));
      }
      await expectLoadError(root, "invalid_json");
    });
  });

  test(`reports a missing ${relativePath} without fallback`, async () => {
    await withRepository(async (root) => {
      await rm(join(root, relativePath));
      await expectLoadError(root, "read_error");
    });
  });
}