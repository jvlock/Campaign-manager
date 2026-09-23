import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";
import { loadWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/loader";
import { validateWebinarStandardCatalog } from "../../src/lib/webinar-standard-catalog/validate";
import { createWebinarEvaluatorRegistry } from "../../src/lib/webinar-standard-evaluation/registry";
import { describeCoverage, SEMANTIC_CONTROLS, type SemanticControl } from "../../src/lib/webinar-standard-evaluation/coverage";
import type {
  EvaluationContext, EventContext, EventOperationalStatus,
  ParticipantAttendanceState, ParticipantContext, RuleEvaluationResult,
} from "../../src/lib/webinar-standard-evaluation/types";
import { makeContext, makeParticipant, makeCommunication } from "./fixtures";

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type HasFunction<T> = T extends (...args: never[]) => unknown ? true
  : T extends readonly (infer U)[] ? HasFunction<U>
  : T extends object ? { [K in keyof T]: HasFunction<T[K]> }[keyof T] : false;

// Positive type-level proofs: compilation fails if these boundaries are weakened.
type StatusesDoNotOverlap = Assert<IsNever<Extract<EventOperationalStatus, ParticipantAttendanceState>>>;
type NoEventAttendance = Assert<IsNever<Extract<keyof EventContext, "attendance" | "attendanceState" | "attended" | "absent" | "unknown">>>;
type AttendanceOnParticipant = Assert<ParticipantContext["attendanceState"] extends ParticipantAttendanceState ? true : false>;
type EventCannotBeParticipant = Assert<EventContext extends ParticipantContext ? false : true>;
type ContextHasNoCapabilities = Assert<true extends HasFunction<EvaluationContext> ? false : true>;
type ResultHasNoCapabilities = Assert<true extends HasFunction<RuleEvaluationResult> ? false : true>;
type StructuralControlsHaveNoIds = Assert<
  Exclude<Extract<SemanticControl, { classification: "structurally_enforced" | "containment_verified" }>["ruleIds"], undefined> extends never ? true : false
>;

const catalog = await loadWebinarStandardCatalog();
const registry = createWebinarEvaluatorRegistry(catalog);

test("coverage addresses 14 semantic checks as 10/2/2 with 53 of 106 rules implemented", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../../docs/standards/webinar/manifest.json", import.meta.url), "utf8",
  )) as { semanticValidation: Record<string, unknown> };
  assert.deepEqual(SEMANTIC_CONTROLS.map((entry) => entry.check).sort(), Object.keys(manifest.semanticValidation).sort());
  const coverage = describeCoverage(registry);
  assert.equal(coverage.semanticChecksTotal, 14);
  assert.equal(coverage.semanticChecksAddressed, 14);
  assert.equal(coverage.evaluatorBacked, 10);
  assert.equal(coverage.structurallyEnforced, 2);
  assert.equal(coverage.containmentVerified, 2);
  assert.equal(coverage.implementedRuleCount, 53);
  assert.equal(coverage.unimplementedRuleCount, 53);
  assert.equal(coverage.totalRuleCount, 106);
  assert.equal(coverage.ruleEngineCoverage, "partial");
  const mappedIds = new Set(SEMANTIC_CONTROLS.flatMap((control) =>
    control.classification === "evaluator_backed" ? [...control.ruleIds] : []));
  assert.equal(mappedIds.size, 15);
  assert.ok([...mappedIds].every(id => registry.implementedRuleIds.includes(id)));
  for (const control of SEMANTIC_CONTROLS) {
    if (control.classification !== "evaluator_backed") assert.equal(Object.hasOwn(control, "ruleIds"), false);
  }
  assert.ok(Object.isFrozen(coverage));
  assert.ok(Object.isFrozen(coverage.controls));
});

test("one event supports attended, absent and unknown participants without an event attendance field", () => {
  const context = makeContext();
  const participants = [
    makeParticipant({ participantId: "attendee", eventId: context.event.eventId, attendanceState: "attended" }),
    makeParticipant({ participantId: "absentee", eventId: context.event.eventId, attendanceState: "absent" }),
    makeParticipant({ participantId: "unresolved", eventId: context.event.eventId, attendanceState: "unknown" }),
  ];
  assert.equal(new Set(participants.map((person) => person.eventId)).size, 1);
  assert.deepEqual(participants.map((person) => person.attendanceState), ["attended", "absent", "unknown"]);
  assert.equal(Object.hasOwn(context.event, "attendanceState"), false);
  const results = participants.map((participant) => registry.evaluate("WEB-FU-UNK-002", { ...context, participant }));
  assert.deepEqual(results.map((result) => result.status), ["not_applicable", "not_applicable", "pass"]);
});

test("participant findings are independent of every event operational status", () => {
  const context = makeContext();
  const statuses: readonly EventOperationalStatus[] = [
    "draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled",
  ];
  for (const ruleId of ["WEB-REC-005", "WEB-REC-008", "WEB-FU-INT-001", "WEB-FU-UNK-002"] as const) {
    const baseline = registry.evaluate(ruleId, context);
    for (const operationalStatus of statuses) {
      assert.deepEqual(registry.evaluate(ruleId, {
        ...context, event: { ...context.event, operationalStatus },
      }), baseline);
    }
  }
});

test("conflicting follow-ups for one unknown participant do not affect other participants", () => {
  const context = makeContext();
  const first = makeParticipant({ participantId: "first", eventId: context.event.eventId, attendanceState: "unknown" });
  const second = makeParticipant({ participantId: "second", eventId: context.event.eventId, attendanceState: "unknown" });
  const communications = [
    makeCommunication({ communicationId: "attended-first", eventId: context.event.eventId, kind: "follow_up", variant: "attended", recipientIds: ["first"] }),
    makeCommunication({ communicationId: "absent-first", eventId: context.event.eventId, kind: "follow_up", variant: "absent", recipientIds: ["first"] }),
  ];
  assert.equal(registry.evaluate("WEB-FU-UNK-002", { ...context, participant: first, communications }).status, "fail");
  assert.equal(registry.evaluate("WEB-FU-UNK-002", { ...context, participant: second, communications }).status, "pass");
  assert.equal(registry.evaluate("WEB-FU-UNK-002", { ...context, participant: first, communications: [communications[0]] }).status, "pass");
  assert.equal(registry.evaluate("WEB-FU-UNK-001", { ...context, participant: first }).status, "unimplemented");
  assert.equal(registry.evaluate("WEB-FU-UNK-003", { ...context, participant: first }).status, "unimplemented");
});

test("unknown-attendance reconciliation is not broadened to non-follow-up communications", () => {
  const context = makeContext();
  const participant = makeParticipant({ eventId: context.event.eventId, attendanceState: "unknown" });
  const communications = [
    makeCommunication({ communicationId: "other-attended", eventId: context.event.eventId, kind: "registrant", variant: "attended", recipientIds: [participant.participantId] }),
    makeCommunication({ communicationId: "other-absent", eventId: context.event.eventId, kind: "registrant", variant: "absent", recipientIds: [participant.participantId] }),
  ];
  assert.equal(registry.evaluate("WEB-FU-UNK-002", { ...context, participant, communications }).status, "pass");
});

function assertDataOnly(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value !== "object") assert.fail("No functions or executable capabilities may appear in data");
  if (Array.isArray(value)) {
    value.forEach(assertDataOnly);
    return;
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!["send", "publish", "deploy", "execute", "authorized", "canSend", "canDeploy", "canPublish"].includes(key));
    assertDataOnly(child);
  }
}

test("evaluation context and every result contain descriptive data only, not execution capabilities", () => {
  const context = makeContext();
  assertDataOnly(context);
  for (const rule of catalog.rules) {
    const result = registry.evaluate(rule.ruleId, context);
    assert.equal(result.mode, "descriptive_only");
    assertDataOnly(result);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  }
});

test("catalog schema does not grant send/deployment authority and rejects authority fields", () => {
  for (const rule of catalog.rules) {
    assertDataOnly(rule);
    assert.deepEqual(Object.keys(rule).sort(), [...catalog.requiredFields, "exceptionEligibleNote"].sort());
  }
  for (const capability of ["send", "publish", "deploy", "canSend", "canDeploy", "authorized"]) {
    const rules = catalog.rules.map((rule, index) => index === 0 ? { ...rule, [capability]: true } : rule);
    const result = validateWebinarStandardCatalog({ ...catalog, rules });
    if (result.ok) assert.fail(`Catalog accepted an unauthorized capability field: ${capability}`);
    assert.ok(result.issues.some((issue) => issue.code === "unknown_field" && issue.field === capability));
  }
  const containment = SEMANTIC_CONTROLS.filter((control) => control.classification === "containment_verified");
  assert.equal(containment.length, 2);
  assert.ok(containment.every((control) => !Object.hasOwn(control, "ruleIds")));
});

const allowedCatalogImports = new Set(["../webinar-standard-catalog/types", "../webinar-standard-catalog/validate"]);
const forbiddenGlobals = new Set([
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "process", "require", "globalThis",
  "global", "window", "Date", "setTimeout", "setInterval", "setImmediate", "queueMicrotask",
  "eval", "Function", "performance", "Deno", "Bun", "navigator", "document", "crypto",
  "localStorage", "sessionStorage", "Worker", "SharedWorker",
]);
type PureSourceOptions = Readonly<{
  localFiles: readonly string[];
  exactImports?: Readonly<Record<string, readonly string[]>>;
  temporalMembers?: readonly string[];
}>;
function assertPureSource(filename: string, content: string, options: PureSourceOptions): void {
    const source = ts.createSourceFile(filename, content, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        assert.ok(ts.isStringLiteral(node.moduleSpecifier));
        const target = node.moduleSpecifier.text;
        const exactNames = options.exactImports?.[target];
        if (exactNames) {
          // No default/namespace/aliased imports or re-exports can expose additional capabilities.
          assert.ok(ts.isImportDeclaration(node), `${filename}: external re-export forbidden`);
          const clause = node.importClause;
          assert.ok(clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings));
          assert.ok(clause.namedBindings.elements.length > 0);
          for (const binding of clause.namedBindings.elements) {
            assert.equal(binding.propertyName, undefined, `${filename}: external aliases forbidden`);
            assert.ok(exactNames.includes(binding.name.text), `${filename}: forbidden imported member ${binding.name.text}`);
          }
        } else {
          assert.ok(allowedCatalogImports.has(target) || (
            target.startsWith("./") && !target.slice(2).includes("/")
              && options.localFiles.includes(`${target.slice(2)}.ts`)
          ), `${filename}: forbidden dependency ${target}`);
        }
      }
      if (ts.isIdentifier(node)) assert.ok(!forbiddenGlobals.has(node.text), `${filename}: forbidden global ${node.text}`);
      if (ts.isCallExpression(node)) assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword, "Dynamic imports are forbidden");
      if (ts.isIdentifier(node) && node.text === "Temporal") {
        const parent = node.parent;
        if (!ts.isImportSpecifier(parent)) {
          // Only explicit deterministic members are available; Now, computed access,
          // alias assignment and destructuring cannot evade the automatic-clock ban.
          const member = ts.isPropertyAccessExpression(parent) && parent.expression === node
            ? parent.name.text : ts.isQualifiedName(parent) && parent.left === node ? parent.right.text : undefined;
          assert.ok(member && options.temporalMembers?.includes(member), `${filename}: forbidden Temporal access`);
        }
      }
      if (ts.isIdentifier(node) && node.text === "Math") {
        const parent = node.parent;
        assert.ok(ts.isPropertyAccessExpression(parent) && parent.expression === node
          && parent.name.text !== "random", `${filename}: indirect or random Math access forbidden`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
}

test("evaluator and evidence modules retain pure domain dependencies and no ambient execution or I/O capabilities", async () => {
  for (const folder of ["webinar-standard-evaluation", "webinar-standard-evidence"]) {
    const directory = new URL(`../../src/lib/${folder}/`, import.meta.url);
    const files = (await readdir(directory)).filter((name) => name.endsWith(".ts"));
    assert.ok(files.includes("types.ts"));
    assert.ok(files.includes(folder === "webinar-standard-evaluation" ? "registry.ts" : "validate.ts"));
    for (const filename of files) {
      const setup = folder === "webinar-standard-evaluation" && filename === "setup-evaluators.ts";
      const scheduling = folder === "webinar-standard-evaluation" && filename === "scheduling-evaluators.ts";
      const schedulingOperational = folder === "webinar-standard-evaluation" && filename === "scheduling-operational.ts";
      const schedulingTypes = folder === "webinar-standard-evaluation" && filename === "scheduling-types.ts";
      assertPureSource(`${folder}/${filename}`, await readFile(new URL(filename, directory), "utf8"), {
        localFiles: files,
        exactImports: setup ? {
          "@js-temporal/polyfill": ["Temporal"],
          "node:util": ["isDeepStrictEqual"],
          "../webinar-standard-planning-time/time": ["assertInstant", "assertTimeZone", "localTime"],
        } : scheduling ? {
          "../webinar-standard-catalog/types": [
            "RuleId", "WebinarStandardCatalog", "READINESS_STAGES", "STANDARD_ID", "STANDARD_VERSION",
          ],
          "../webinar-standard-scheduling": [
            "RECRUITMENT_TOUCH_IDENTITIES", "validateRecruitmentPlanResult",
            "PlannedRecruitmentTouch", "RecruitmentPlan", "RecruitmentTouchIdentity",
            "RecruitmentWarning", "RecruitmentWindowBand",
          ],
        } : schedulingOperational ? {
          "../webinar-standard-catalog/types": [
            "RuleId", "WebinarStandardCatalog", "STANDARD_ID", "STANDARD_VERSION",
          ],
          "../webinar-standard-evidence/validate": ["validateManualEvidence"],
          "../webinar-standard-planning-time/time": ["assertInstant"],
          "../webinar-standard-readiness/result-validation": ["validateIncomingResults"],
          "../webinar-standard-scheduling/types": ["RecruitmentPlan"],
        } : schedulingTypes ? {
          "../webinar-standard-catalog/types": ["RuleId", "StandardId", "StandardVersion"],
          "../webinar-standard-audience/types": ["WebinarAudiencePlan"],
          "../webinar-standard-evidence/types": ["ManualEvidence"],
          "./types": ["RuleEvaluationResult"],
          "../webinar-standard-scheduling/types": [
            "RecruitmentPlan", "RecruitmentTouchDisposition", "RecruitmentTouchIdentity",
            "RecruitmentTouchReason", "RecruitmentWarning",
          ],
        } : {},
        temporalMembers: setup ? ["PlainDate", "PlainTime"] : [],
      });
    }
    assert.ok(fileURLToPath(directory).endsWith(`/${folder}/`));
  }
  // Check the admitted time-helper dependency too, rather than trusting its path alone.
  const helper = new URL("../../src/lib/webinar-standard-planning-time/time.ts", import.meta.url);
  assertPureSource("planning-time/time.ts", await readFile(helper, "utf8"), {
    localFiles: [], exactImports: { "@js-temporal/polyfill": ["Temporal"] },
    temporalMembers: ["Instant", "ZonedDateTime", "PlainDateTime"],
  });

  // The scheduling evaluator admits only this reviewed pure scheduler surface.
  // Scan the validator and its plan/type dependencies rather than trusting the barrel import.
  const schedulingDirectory = new URL("../../src/lib/webinar-standard-scheduling/", import.meta.url);
  const schedulingFiles = (await readdir(schedulingDirectory)).filter(name => name.endsWith(".ts")).sort();
  assert.deepEqual(schedulingFiles, ["index.ts", "plan.ts", "types.ts", "validate-result.ts"]);
  for (const filename of schedulingFiles) {
    const plan = filename === "plan.ts";
    const types = filename === "types.ts";
    const validator = filename === "validate-result.ts";
    assertPureSource(`webinar-standard-scheduling/${filename}`,
      await readFile(new URL(filename, schedulingDirectory), "utf8"), {
        localFiles: schedulingFiles,
        exactImports: plan ? {
          "../webinar-standard-catalog/types": ["RuleId", "WebinarStandardCatalog"],
          "../webinar-standard-catalog/validate": ["validateWebinarStandardCatalog"],
          "../webinar-standard-evaluation/types": ["EventOperationalStatus"],
          "../webinar-standard-readiness/safe-data": ["freezeOwned", "isRecord", "snapshotData"],
          "../webinar-standard-planning-time/time": [
            "assertInstant", "assertTimeZone", "calendarDaysBetween", "localTime", "shiftCalendarDays",
          ],
        } : types ? {
          "../webinar-standard-catalog/types": [
            "RuleId", "StandardId", "StandardVersion", "WebinarStandardCatalog",
          ],
          "../webinar-standard-evaluation/types": ["EventOperationalStatus"],
        } : validator ? {
          "@js-temporal/polyfill": ["Temporal"],
          "../webinar-standard-catalog/types": ["StandardId", "StandardVersion"],
          "../webinar-standard-evaluation/types": ["EventOperationalStatus"],
          "../webinar-standard-planning-time/time": ["assertInstant", "assertTimeZone", "localTime"],
        } : {},
        temporalMembers: validator ? ["PlainDateTime"] : [],
      });
  }
});

test("purity guard rejects automatic clocks, indirect Temporal access and capability imports", () => {
  const options: PureSourceOptions = {
    localFiles: [], exactImports: {
      "@js-temporal/polyfill": ["Temporal"], "node:util": ["isDeepStrictEqual"],
      "../webinar-standard-planning-time/time": ["assertInstant", "assertTimeZone", "localTime"],
    }, temporalMembers: ["PlainDate", "PlainTime"],
  };
  for (const source of [
    "Date.now()", "new Date()", "process.env.SECRET", "performance.now()",
    "Temporal.Now.instant()", "Temporal['Now'].instant()", "const { Now } = Temporal",
    "const clock = Temporal", "Math.random()", "Math['random']()", "const { random } = Math",
    "fetch('https://example.test')", "import('node:fs')",
    "import fs from 'node:fs'", "import { inspect } from 'node:util'",
    "import * as util from 'node:util'", "export * from 'node:util'",
    "import { Temporal as clock } from '@js-temporal/polyfill'",
    "import { shiftCalendarDays } from '../webinar-standard-planning-time/time'",
  ]) assert.throws(() => assertPureSource("negative-probe.ts", source, options), source);
  assert.doesNotThrow(() => assertPureSource("deterministic-probe.ts", [
    "import { Temporal } from '@js-temporal/polyfill';",
    "import { isDeepStrictEqual } from 'node:util';",
    "import { localTime } from '../webinar-standard-planning-time/time';",
    "Temporal.PlainDate.from('2030-01-01'); Temporal.PlainTime.from('12:00');",
    "isDeepStrictEqual({}, {}); localTime(0, 'UTC');",
  ].join("\n"), options));
});