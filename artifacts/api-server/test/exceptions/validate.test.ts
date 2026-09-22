import assert from "node:assert/strict";
import { test } from "node:test";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import type { RuleId, WebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/types";
import {
  validateWebinarException,
  type ExceptionValidationIssue,
  type WebinarException,
} from "../../src/lib/webinar-standard-exceptions/index";

const catalog = await loadWebinarStandardCatalog();
const eligible = catalog.rules.find((rule) => rule.exceptionEligible);
assert.ok(eligible, "The authentic catalog must contain an exception-eligible rule.");
const target = eligible.ruleId;
const requirement = eligible.expectedBehavior;
const now = 1_893_499_200_000;

function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exceptionId: "exception-pilot-1",
    standardId: catalog.standardId,
    standardVersion: catalog.standardVersion,
    ruleId: target,
    requirementOverridden: requirement,
    businessJustification: "The pilot audience requires a different communication sequence for this activity.",
    requestor: "Pilot requestor",
    reviewer: "Pilot reviewer",
    reviewerVerificationStatus: "unverified",
    decision: "approved",
    decisionAtEpochMs: now - 1000,
    expiresAtEpochMs: now + 1000,
    expirationRequired: true,
    compensatingAction: "Review the adapted sequence before sending recruitment communications.",
    compensatingActionRequired: true,
    createdAtEpochMs: now - 2000,
    pilotAudit: { pilotReference: "pilot-2030-1", auditReference: "audit-2030-1" },
    ...overrides,
  };
}

function issuesFor(input: unknown, suppliedCatalog = catalog, time = now, targetRuleId = target): readonly ExceptionValidationIssue[] {
  const result = validateWebinarException(input, suppliedCatalog, time, targetRuleId);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Expected invalid exception.");
  assert.ok(result.issues.length);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.issues));
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue), ["code", "field", "message"]);
    assert.ok(Object.isFrozen(issue));
  }
  return result.issues;
}

function expectIssue(input: unknown, code: string, field?: string): void {
  assert.ok(issuesFor(input).some((issue) => issue.code === code && (field === undefined || issue.field === field)));
}

test("accepts the real catalog requirement with explicit documentary unverified status", () => {
  const input = fixture();
  const result = validateWebinarException(input, catalog, now, target);
  assert.ok(result.ok);
  assert.deepEqual(result.exception, input);
  assert.equal(result.exception.reviewerVerificationStatus, "unverified");
  assert.equal(catalog.rules.length, 106);
});

for (const decision of ["approved", "pending", "rejected", "returned", "expired", "revoked", "APPROVED", "", null, true]) {
  test(`decision matrix: ${String(decision)}`, () => {
    const result = validateWebinarException(fixture({ decision }), catalog, now, target);
    assert.equal(result.ok, decision === "approved");
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "not_approved"));
  });
}

for (const reviewerVerificationStatus of ["not_recorded", "verified", "", null, true]) {
  test(`requires explicitly unverified reviewer status: ${String(reviewerVerificationStatus)}`, () => {
    expectIssue(fixture({ reviewerVerificationStatus }), "reviewer_unverified_required", "reviewerVerificationStatus");
  });
}

for (const [offset, valid] of [[-1, false], [0, false], [1, true]] as const) {
  test(`expiration boundary now ${offset >= 0 ? "+" : ""}${offset}`, () => {
    const result = validateWebinarException(fixture({ expiresAtEpochMs: now + offset }), catalog, now, target);
    assert.equal(result.ok, valid);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "expired"));
  });
}

test("optional expiration and compensation use explicit null, not absent properties", () => {
  assert.ok(validateWebinarException(fixture({
    expirationRequired: false, expiresAtEpochMs: null,
    compensatingActionRequired: false, compensatingAction: null,
  }), catalog, now, target).ok);
  expectIssue(fixture({ expiresAtEpochMs: null }), "expiration_required", "expiresAtEpochMs");
  expectIssue(fixture({ compensatingAction: null }), "compensating_action_required", "compensatingAction");
  // Optional supplied data must still be valid and effective.
  expectIssue(fixture({ expirationRequired: false, expiresAtEpochMs: now }), "expired");
  expectIssue(fixture({ compensatingActionRequired: false, compensatingAction: "TBD" }), "placeholder");
});

for (const field of Object.keys(fixture())) {
  test(`rejects absent required field ${field}`, () => {
    const input = fixture();
    delete input[field];
    expectIssue(input, "missing_field", field);
  });
}
for (const field of ["pilotReference", "auditReference"]) {
  test(`rejects absent nested audit field ${field}`, () => {
    const audit: Record<string, unknown> = { pilotReference: "pilot-1", auditReference: "audit-1" };
    delete audit[field];
    expectIssue(fixture({ pilotAudit: audit }), "missing_field", `pilotAudit.${field}`);
  });
}

for (const field of ["exceptionId", "requestor", "reviewer", "compensatingAction"]) {
  for (const value of ["", "  ", "TBD", "placeholder", "N/A", "not recorded", 1, false, {}, []]) {
    test(`invalid text ${field}: ${JSON.stringify(value)}`, () => {
      assert.ok(issuesFor(fixture({ [field]: value })).some((issue) => issue.field === field));
    });
  }
}
for (const field of ["pilotReference", "auditReference"]) {
  for (const value of ["", " ", "TODO", null, 7]) {
    test(`invalid audit text ${field}: ${JSON.stringify(value)}`, () => {
      const audit = { pilotReference: "pilot-1", auditReference: "audit-1", [field]: value };
      assert.ok(issuesFor(fixture({ pilotAudit: audit })).some((issue) => issue.field === `pilotAudit.${field}`));
    });
  }
}
for (const businessJustification of [
  "", "Short explanation", "   nineteen characters   ", "placeholder justification with enough characters",
  "TODO explain the business justification later", null, 42, {},
]) {
  test(`substantive justification rejects ${JSON.stringify(businessJustification)}`, () => {
    assert.ok(issuesFor(fixture({ businessJustification })).some((issue) => issue.field === "businessJustification"));
  });
}

test("justification length is trimmed and has an inclusive twenty-character minimum", () => {
  assert.equal("nineteen characters".length, 19);
  assert.ok(validateWebinarException(fixture({ businessJustification: "  twenty characters ok  " }), catalog, now, target).ok);
});

test("identity and requirement bindings are exact, not normalized or coercible", () => {
  for (const field of ["standardId", "standardVersion"]) {
    for (const value of ["wrong", null, {}, `${catalog[field as "standardId" | "standardVersion"]} `]) {
      expectIssue(fixture({ [field]: value }), "standard_mismatch", field);
    }
  }
  for (const value of ["unrelated requirement", `${requirement} `, null, {}]) {
    expectIssue(fixture({ requirementOverridden: value }), "requirement_mismatch");
  }
  expectIssue(fixture({ ruleId: "WEB-UNKNOWN-999" }), "rule_mismatch");
  const other = catalog.rules.find((rule) => rule.ruleId !== target);
  assert.ok(other);
  expectIssue(fixture({ ruleId: other.ruleId }), "rule_mismatch");
});

test("every authentic ineligible rule stays ineligible even with complete matching data", () => {
  for (const rule of catalog.rules.filter((entry) => !entry.exceptionEligible)) {
    const issues = issuesFor(fixture({
      ruleId: rule.ruleId, requirementOverridden: rule.expectedBehavior,
    }), catalog, now, rule.ruleId);
    assert.ok(issues.some((issue) => issue.code === (rule.ruleId === "WEB-EXC-001" ? "self_exception" : "not_exception_eligible")), rule.ruleId);
  }
});

test("every authentic eligible rule accepts its own exact canonical requirement", () => {
  for (const rule of catalog.rules.filter((entry) => entry.exceptionEligible)) {
    assert.ok(validateWebinarException(fixture({
      ruleId: rule.ruleId, requirementOverridden: rule.expectedBehavior,
    }), catalog, now, rule.ruleId).ok, rule.ruleId);
  }
});

test("unknown targets fail and WEB-EXC-001 cannot exempt itself even if supplied as eligible", () => {
  const unknown = "WEB-NOT-A-RULE" as RuleId;
  assert.ok(issuesFor(fixture({ ruleId: unknown }), catalog, now, unknown).some((issue) => issue.code === "unknown_rule"));
  expectIssue(fixture({ ruleId: "WEB-EXC-001" }), "self_exception");
  const altered = structuredClone(catalog);
  const rules = altered.rules.map((rule) => rule.ruleId === "WEB-EXC-001" ? { ...rule, exceptionEligible: true } : rule);
  const governing = rules.find((rule) => rule.ruleId === "WEB-EXC-001");
  assert.ok(governing);
  assert.ok(issuesFor(fixture({
    ruleId: governing.ruleId, requirementOverridden: governing.expectedBehavior,
  }), { ...altered, rules }, now, governing.ruleId).some((issue) => issue.code === "self_exception"));
});

for (const field of ["expirationRequired", "compensatingActionRequired"]) {
  for (const value of ["true", "false", 1, 0, null, {}]) {
    test(`no flag coercion ${field}: ${JSON.stringify(value)}`, () => {
      expectIssue(fixture({ [field]: value }), "invalid_type", field);
    });
  }
}

for (const value of [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, "1893499200000", null, undefined, {}]) {
  for (const field of ["createdAtEpochMs", "decisionAtEpochMs", "expiresAtEpochMs"]) {
    if (field === "expiresAtEpochMs" && value === null) continue;
    test(`invalid timestamp ${field}: ${String(value)}`, () => {
      expectIssue(fixture({ [field]: value }), "invalid_time", field);
    });
  }
  test(`invalid supplied evaluation time: ${String(value)}`, () => {
    const result = validateWebinarException(fixture(), catalog, value as number, target);
    assert.equal(result.ok, false);
    if (result.ok) assert.fail("Expected invalid evaluation time.");
    assert.ok(result.issues.some((issue) => issue.field === "evaluationTimeEpochMs"));
  });
}

test("lifecycle ordering and effectiveness checks use only supplied time", () => {
  expectIssue(fixture({ createdAtEpochMs: now }), "invalid_lifecycle", "createdAtEpochMs");
  expectIssue(fixture({ decisionAtEpochMs: now + 1 }), "not_effective", "decisionAtEpochMs");
  expectIssue(fixture({ expiresAtEpochMs: now - 1000 }), "invalid_lifecycle", "expiresAtEpochMs");
  expectIssue(fixture({ expiresAtEpochMs: now - 1001 }), "invalid_lifecycle", "expiresAtEpochMs");
  assert.ok(validateWebinarException(fixture({
    createdAtEpochMs: now, decisionAtEpochMs: now,
  }), catalog, now, target).ok);
  assert.ok(validateWebinarException(fixture({
    createdAtEpochMs: 0, decisionAtEpochMs: 0, expiresAtEpochMs: 1,
  }), catalog, 0, target).ok);
  const input = fixture();
  assert.ok(validateWebinarException(input, catalog, now, target).ok);
  assert.ok(issuesFor(input, catalog, now + 1000).some((issue) => issue.code === "expired"));
  assert.ok(validateWebinarException(input, catalog, now, target).ok);
});

test("returns fresh deeply frozen copies without mutating or freezing caller data", () => {
  const input = fixture();
  const supplied = structuredClone(catalog);
  const beforeInput = structuredClone(input);
  const beforeCatalog = structuredClone(supplied);
  const result = validateWebinarException(input, supplied, now, target);
  const again = validateWebinarException(input, supplied, now, target);
  assert.ok(result.ok && again.ok);
  assert.deepEqual(result, again);
  assert.notEqual(result, again);
  assert.notEqual(result.exception, input);
  assert.notEqual(result.exception, again.exception);
  assert.notEqual(result.exception.pilotAudit, input.pilotAudit);
  assert.notEqual(result.exception.pilotAudit, again.exception.pilotAudit);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.exception));
  assert.ok(Object.isFrozen(result.exception.pilotAudit));
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(input.pilotAudit), false);
  assert.equal(Object.isFrozen(supplied), false);
  assert.equal(Object.isFrozen(supplied.rules), false);
  assert.equal(Object.isFrozen(supplied.rules[0]), false);
  assert.deepEqual(input, beforeInput);
  assert.deepEqual(supplied, beforeCatalog);
  input.requestor = "Changed afterward";
  (input.pilotAudit as Record<string, unknown>).auditReference = "Changed afterward";
  assert.deepEqual(result.exception, beforeInput);
  assert.throws(() => Object.assign(result.exception, { requestor: "changed" }), TypeError);
  assert.throws(() => Object.assign(result.exception.pilotAudit, { auditReference: "changed" }), TypeError);
});

test("accepts frozen and null-prototype data records", () => {
  const input = Object.assign(Object.create(null) as Record<string, unknown>, fixture());
  input.pilotAudit = Object.freeze(Object.assign(Object.create(null) as object, input.pilotAudit));
  assert.ok(validateWebinarException(Object.freeze(input), catalog, now, target).ok);
});

test("failure data is immutable, fresh, deterministic, and excludes raw attacker text", () => {
  const secret = "attacker-secret-do-not-echo";
  const input = fixture({ decision: secret, [secret]: secret, zzz: true, aaa: true });
  const reversed = Object.fromEntries(Object.entries(input).reverse());
  const first = issuesFor(input);
  const second = issuesFor(reversed);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.equal(JSON.stringify(first).includes(secret), false);
  assert.equal(first.filter((issue) => issue.code === "unknown_field").length, 3);
  assert.throws(() => Object.assign(first[0]!, { message: "changed" }), TypeError);
  assert.throws(() => Array.prototype.pop.call(first), TypeError);
  assert.equal(Object.isFrozen(input), false);
});

for (const value of [null, undefined, true, 0, "text", [], new Date(0), new Map(), new Set(), /x/, () => fixture()]) {
  test(`rejects non-record input ${Object.prototype.toString.call(value)}`, () => {
    expectIssue(value, "invalid_type", "$");
    expectIssue(fixture({ pilotAudit: value }), "invalid_type", "pilotAudit");
  });
}

test("rejects inherited fields, custom prototypes, cycles, symbols and unknown nested fields", () => {
  expectIssue(Object.create(fixture()) as unknown, "invalid_type", "$");
  const root = fixture();
  root.pilotAudit = root;
  issuesFor(root);
  const nested: Record<string, unknown> = { pilotReference: "pilot-1", auditReference: "audit-1" };
  nested.auditReference = nested;
  expectIssue(fixture({ pilotAudit: nested }), "invalid_type", "pilotAudit.auditReference");
  const primitiveCycle = fixture();
  primitiveCycle.requestor = primitiveCycle;
  expectIssue(primitiveCycle, "invalid_type", "requestor");
  const symbolRoot = fixture();
  Object.defineProperty(symbolRoot, Symbol("private attacker symbol"), { value: true });
  expectIssue(symbolRoot, "unknown_field", "[symbol]");
  const audit = { pilotReference: "pilot-1", auditReference: "audit-1", extra: true, [Symbol("secret")]: true };
  expectIssue(fixture({ pilotAudit: audit }), "unknown_field", "pilotAudit.[unknown]");
  expectIssue(fixture({ pilotAudit: audit }), "unknown_field", "pilotAudit.[symbol]");
});

test("never invokes getters, conversion methods or inherited accessors", () => {
  let calls = 0;
  const getter = (): never => { calls++; throw new Error("getter must not execute"); };
  for (const field of Object.keys(fixture())) {
    const input = fixture();
    Object.defineProperty(input, field, { get: getter });
    expectIssue(input, "invalid_type", field);
  }
  const audit = { pilotReference: "pilot-1" };
  Object.defineProperty(audit, "auditReference", { get: getter });
  expectIssue(fixture({ pilotAudit: audit }), "invalid_type", "pilotAudit.auditReference");
  const input = fixture();
  Object.defineProperty(input, "unknown-getter", { get: getter });
  expectIssue(input, "unknown_field");
  const conversion = { toString: getter, valueOf: getter, [Symbol.toPrimitive]: getter };
  expectIssue(fixture({ requestor: conversion }), "invalid_type");
  const inherited = Object.create({ get requestor() { return getter(); } }) as unknown;
  expectIssue(inherited, "invalid_type");
  assert.equal(calls, 0);
});

test("throwing and revoked proxy inspection fails closed without throwing outward", () => {
  const throwing = new Proxy({}, { getPrototypeOf() { throw new Error("private trap payload"); } });
  expectIssue(throwing, "invalid_type", "$");
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expectIssue(revoked.proxy, "invalid_type", "$");
  expectIssue(fixture({ pilotAudit: revoked.proxy }), "invalid_type", "pilotAudit");
});

test("defensively revalidates supplied catalog and sanitizes its diagnostics", () => {
  for (const supplied of [null, {}, { ...catalog, standardVersion: "private-invalid-version" }, { ...catalog, rules: [] }]) {
    const issues = issuesFor(fixture(), supplied as WebinarStandardCatalog);
    assert.ok(issues.some((issue) => issue.code === "invalid_catalog" && issue.field === "catalog"));
    assert.equal(JSON.stringify(issues).includes("private-invalid-version"), false);
  }
  let calls = 0;
  const supplied = { ...catalog };
  Object.defineProperty(supplied, "rules", { get() { calls++; throw new Error("not data"); } });
  assert.ok(issuesFor(fixture(), supplied).some((issue) => issue.code === "invalid_catalog"));
  assert.equal(calls, 0);
  assert.equal(Object.isFrozen(supplied), false);
});

// Compile-time contract only: these statements must never execute.
function readonlyContract(value: WebinarException): void {
  // @ts-expect-error Public fields are readonly.
  value.decision = "pending";
  // @ts-expect-error Nested pilot audit fields are readonly.
  value.pilotAudit.auditReference = "changed";
}
void readonlyContract;