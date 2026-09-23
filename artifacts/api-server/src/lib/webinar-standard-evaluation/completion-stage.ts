import type { WebinarStandardCatalog, RuleId } from "../webinar-standard-catalog/types";
import { snapshotData } from "../webinar-standard-readiness/safe-data";
import { validateIncomingResults } from "../webinar-standard-readiness/result-validation";
import { validateWebinarAudiencePlanResult } from "../webinar-standard-audience/validate-result";
import { resolveClaims } from "../webinar-standard-readiness/claims";
import { validateWebinarException } from "../webinar-standard-exceptions/validate";
import type { EvaluationContext, RuleEvaluator, RuleFinding, RuleEvaluationResult } from "./types";
import type { CompletionStageContext, EvaluationContextWithCompletion } from "./completion-stage-types";

export const COMPLETION_STAGE_RULE_IDS = Object.freeze([
  "WEB-RDY-COMP-001", "WEB-RDY-COMP-002", "WEB-RDY-COMP-003",
  "WEB-RDY-COMP-004", "WEB-EXC-001",
] as const);

const pass = (evidence: string): RuleFinding => ({ status: "pass", reason: "satisfied", evidence: [evidence] });
const fail = (evidence: string): RuleFinding => ({ status: "fail", reason: "violation", evidence: [evidence] });
const missing = (evidence: string): RuleFinding => ({ status: "evidence_unavailable", reason: "missing_evidence", evidence: [evidence] });
const invalid = (evidence: string): RuleFinding => ({ status: "fail", reason: "invalid_context", evidence: [evidence] });
const na = (evidence: string): RuleFinding => ({ status: "not_applicable", reason: "condition_not_met", evidence: [evidence] });
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

function stage(c: EvaluationContext): CompletionStageContext | null {
  return (c as EvaluationContextWithCompletion).completionStage ?? null;
}
function common(c: EvaluationContext, s: CompletionStageContext | null): RuleFinding | null {
  if (!s) return missing("Complete-stage observation context is required.");
  if (s.eventId !== c.event.eventId || !text(s.occurrenceId)) return invalid("Completion observation scope does not match the event.");
  if (!text(s.snapshotId) || s.complete !== true) return missing("A complete current completion snapshot is required.");
  if (s.standardId !== undefined && s.standardId !== "WEB-STANDARD-001") return invalid("Completion standard identity is invalid.");
  if (s.standardVersion !== undefined && s.standardVersion !== "1.0-pilot-rc1") return invalid("Completion standard version is invalid.");
  const currentSnapshot = c.setup?.snapshotId ?? c.measurementPlan?.snapshotId;
  if (s.snapshotId !== undefined && (!text(s.snapshotId) || currentSnapshot !== undefined && s.snapshotId !== currentSnapshot)) return invalid("Completion snapshot is stale or out of scope.");
  return null;
}
function incoming(raw: readonly RuleEvaluationResult[] | undefined, catalog: WebinarStandardCatalog) {
  return validateIncomingResults(raw ?? [], catalog);
}
function resultProblem(raw: readonly RuleEvaluationResult[] | undefined, catalog: WebinarStandardCatalog, eventId: string): RuleFinding | null {
  const checked = incoming(raw, catalog);
  if (checked.issues.length) return invalid("Results contain duplicate, missing, unknown, or malformed records.");
  if (checked.results.some(r => r.standardId !== catalog.standardId || r.standardVersion !== catalog.standardVersion
    || r.participantId !== null && !text(r.participantId))) return invalid("Result identity is not bound to this standard.");
  return null;
}

function comp001(catalog: WebinarStandardCatalog, c: EvaluationContext, s: CompletionStageContext): RuleFinding {
  const bad = common(c, s) ?? resultProblem(s.unknownFollowUpResults ?? s.followUpResults, catalog, c.event.eventId);
  if (bad) return bad;
  if (s.audience && (s.audience.eventId !== c.event.eventId || s.audience.occurrenceId !== s.occurrenceId)) return invalid("Unknown population scope does not match completion occurrence.");
  const unknown = s.unknownFollowUpResults ?? s.findingEvidence?.unknownFollowUpResults ?? [];
  const unknownPeople = c.audience?.input.participants.filter(p => p.attendanceState === "unknown")
    ?? s.audience?.participants?.filter(p => p.attendanceState === "unknown") ?? [];
  const hasUnknown = unknownPeople.length > 0;
  if (!unknown.length) return hasUnknown ? missing("Unknown-attendance reconciliation findings are missing.") : na("No attendance-unknown reconciliation obligation was supplied.");
  const ids = new Set(unknown.map(r => r.ruleId));
  if (ids.size !== unknown.length || unknown.some(r => !["WEB-FU-UNK-001", "WEB-FU-UNK-003"].includes(r.ruleId))) {
    return invalid("Unknown-attendance findings must be complete and limited to the canonical unknown rules.");
  }
  if (unknown.length !== unknownPeople.length * 2) return missing("Unknown-attendance findings are incomplete for the complete unknown population.");
  for (const person of unknownPeople) {
    const own = unknown.filter(r => r.participantId === person.participantId);
    if (own.length !== 2 || new Set(own.map(r => r.ruleId)).size !== 2
      || !own.some(r => r.ruleId === "WEB-FU-UNK-001" && r.status === "pass")
      || !own.some(r => r.ruleId === "WEB-FU-UNK-003" && (r.status === "pass" || r.status === "not_applicable"))) {
      return invalid("Unknown reconciliation requires UNK-001 plus eligible or correctly inapplicable UNK-003 per person.");
    }
  }
  if (unknown.some(r => r.status === "evidence_unavailable" || r.status === "unimplemented")) return missing("Unknown-attendance reconciliation remains unresolved.");
  return unknown.every(r => r.status === "pass" || r.status === "not_applicable")
    ? pass("All applicable attendance-unknown obligations are reconciled or explicitly inapplicable.")
    : fail("Attendance-unknown reconciliation remains unresolved.");
}

function comp002(catalog: WebinarStandardCatalog, c: EvaluationContext, s: CompletionStageContext): RuleFinding {
  const a = s.audience;
  const bad = common(c, s);
  if (bad) return bad;
  const audienceInput = c.audience?.input;
  if (!a && !audienceInput) return missing("Complete audience-state snapshot is required.");
  if (a && (a.eventId !== c.event.eventId || a.occurrenceId !== s.occurrenceId || a.complete !== true)) return invalid("Audience snapshot is incomplete or out of scope.");
  if (audienceInput && (audienceInput.event.eventId !== c.event.eventId
    || audienceInput.standardId !== catalog.standardId || audienceInput.standardVersion !== catalog.standardVersion)) {
    return invalid("Audience planner input is out of scope.");
  }
  if (audienceInput && a) {
    const expectedPopulation = audienceInput.participants.map(p => `${p.participantId}:${p.attendanceState}`).sort();
    const suppliedPopulation = (a.participants ?? []).map(p => `${p.participantId}:${p.attendanceState}`).sort();
    if (expectedPopulation.join("|") !== suppliedPopulation.join("|")) return invalid("Completion audience population/state does not match current planner input.");
  }
  if (!a && c.audience && audienceInput && validateWebinarAudiencePlanResult(c.audience.plan, audienceInput, catalog)) {
    return invalid("Audience planner result is structurally invalid.");
  }
  const people = a?.participants
    ?? (a?.participantIds ?? audienceInput?.participants.map(p => p.participantId) ?? [])
      .map(participantId => ({ participantId, attendanceState: "unknown" as const }));
  if (!people.length || new Set(people.map(p => p.participantId)).size !== people.length || people.some(p => !text(p.participantId))) {
    return invalid("Audience snapshot must contain a unique per-person state.");
  }
  const findings = s.followUpResults ?? s.findingEvidence?.followUpResults ?? s.results ?? [];
  const states = new Map((a?.participants ?? audienceInput?.participants.map(p => ({
    participantId: p.participantId, attendanceState: p.attendanceState,
    registrationStatus: p.registrationStatus, audienceClass: p.audienceClass,
  })) ?? []).map(p => [p.participantId, p.attendanceState]));
  const details = new Map((audienceInput?.participants ?? []).map(p => [p.participantId, p]));
  const applicable = (person: { participantId: string; attendanceState: string }): readonly string[] => {
    if (person.attendanceState === "attended") return [
      "WEB-FU-ATT-001", "WEB-FU-ATT-002", "WEB-FU-ATT-003", "WEB-FU-ATT-004", "WEB-FU-ATT-005",
      "WEB-FU-VAR-001",
    ];
    if (person.attendanceState === "absent") return [
      "WEB-FU-ABS-001", "WEB-FU-ABS-002", "WEB-FU-ABS-003", "WEB-FU-ABS-004", "WEB-FU-ABS-005",
      "WEB-FU-VAR-001",
    ];
    return ["WEB-FU-UNK-001", "WEB-FU-UNK-002", "WEB-FU-UNK-003"];
  };
  const relevant = findings.filter(r => r.participantId !== null);
  for (const person of people) {
    const own = relevant.filter(r => r.participantId === person.participantId);
    const state = states.get(person.participantId);
    if (!state) return missing("Complete audience snapshot does not establish participant applicability.");
    const expected = [...applicable({ participantId: person.participantId, attendanceState: state })];
    const detail = details.get(person.participantId);
    if (!detail) return missing("Complete audience snapshot does not establish waitlist/cancellation/internal applicability.");
    if (detail.registrationStatus === "waitlisted") expected.push("WEB-FU-WL-001", "WEB-FU-WL-002", "WEB-FU-WL-003", "WEB-FU-WL-004");
    if (detail.registrationStatus === "cancelled") expected.push("WEB-FU-CAN-001", "WEB-FU-CAN-002");
    if (detail.audienceClass === "internal" || detail.audienceClass === "test") expected.push("WEB-FU-INT-001", "WEB-FU-INT-002");
    if (new Set(own.map(r => r.ruleId)).size !== own.length || own.some(r => !expected.includes(r.ruleId))) return invalid("Per-person Section E findings contain duplicates or wrong attendance state.");
    for (const id of expected) {
      const result = own.find(r => r.ruleId === id);
      if (!result) return missing(`Applicable Section E finding ${id} is missing for participant ${person.participantId}.`);
      const issue = resultProblem([result], catalog, c.event.eventId);
      if (issue) return issue;
      if (result.status === "evidence_unavailable" || result.status === "unimplemented") return missing("Applicable per-person follow-up evidence is unavailable.");
      const mandatory = new Set(["WEB-FU-ATT-001", "WEB-FU-ABS-001", "WEB-FU-UNK-001", "WEB-FU-UNK-002"]);
      if (result.status === "not_applicable" && mandatory.has(id)) return fail("A known-applicable mandatory Section E obligation was incorrectly marked not applicable.");
      if (result.status === "fail") return fail("An applicable per-person follow-up obligation remains unresolved.");
    }
  }
  return pass("Every applicable Section E follow-up result is covered for the complete audience mix.");
}

function comp003(catalog: WebinarStandardCatalog, c: EvaluationContext, s: CompletionStageContext): RuleFinding {
  const bad = common(c, s);
  if (bad) return bad;
  const used = s.usedExceptionIds ?? s.findingEvidence?.usedExceptionIds ?? [];
  if (!used.length && !(s.exceptionClaims?.length)) return na("No exception is recorded as used.");
  if (!used.length) return fail("Exception claims exist but the used-exception inventory is empty.");
  const exceptions = s.exceptions ?? s.findingEvidence?.exceptions;
  const sourceFindings = s.sourceFindings ?? s.findingEvidence?.sourceFindings;
  if (!exceptions || !s.exceptionClaims || !sourceFindings) return missing("Used exception inventory and originating findings are required.");
  if (!s.exceptionProvenance || s.exceptionProvenance.length !== s.exceptionClaims.length
    || s.exceptionProvenance.some(p => p.eventId !== c.event.eventId || p.occurrenceId !== s.occurrenceId
      || !text(p.originalFindingId) || p.originalStatus !== "fail"
      || !s.exceptionClaims!.some(cl => cl.exceptionId === p.exceptionId && cl.ruleId === p.ruleId)
      || sourceFindings.filter(f => f.ruleId === p.ruleId && f.status === "fail" && f.reason === "violation")
        .every(f => !f.evidence.includes(p.originalFindingId)))) {
    return fail("Used exception inventory lacks exact original-finding provenance.");
  }
  if (new Set(used).size !== used.length || used.some(id => !text(id))) return invalid("Exception usage inventory contains duplicate or malformed IDs.");
  const claimed = s.exceptionClaims.map(cl => cl.exceptionId);
  const supplied = exceptions.map(x => typeof x === "object" && x !== null && "exceptionId" in x
    ? (x as { exceptionId?: unknown }).exceptionId : null);
  if (new Set(claimed).size !== claimed.length || claimed.some(id => !used.includes(id))
    || used.some(id => !claimed.includes(id)) || supplied.some(id => typeof id !== "string" || !used.includes(id))) {
    return invalid("Used exceptions, claims, and supplied records must exactly cover one another.");
  }
  const claims = resolveClaims(s.exceptionClaims, exceptions, catalog, sourceFindings, [], c.observedAtEpochMs);
  if (claims.issues.length || claims.resolutions.length !== used.length) return fail("Used exception inventory is incomplete or unresolved.");
  return pass("Every used exception has a complete, separately represented resolution.");
}

function comp004(catalog: WebinarStandardCatalog, c: EvaluationContext, s: CompletionStageContext): RuleFinding {
  const bad = common(c, s);
  if (bad) return bad;
  const targets = c.setup?.measurementTargets ?? c.measurementPlan?.targets?.map(t => t.targetId) ?? null;
  const targetDefinitions = c.measurementPlan?.targets ?? [];
  if (targets === null) return missing("SETUP-018 measurement target selection is required.");
  if (!targets.length) return fail("SETUP-018 requires at least one selected measurement target.");
  const actuals = s.measurementActuals;
  if (!actuals) return missing("Measurement actuals are required for every selected target.");
  if (new Set(actuals.map(a => a.targetId)).size !== actuals.length || actuals.some(a =>
    !targets.includes(a.targetId) || a.eventId !== c.event.eventId || a.occurrenceId !== s.occurrenceId
    || a.snapshotId !== (c.measurementPlan?.snapshotId ?? c.setup?.snapshotId)
    || a.observedAtEpochMs > c.observedAtEpochMs || !text(a.snapshotId) || !time(a.observedAtEpochMs)
    || typeof a.value !== "number" || !Number.isFinite(a.value) || !text(a.unit)
    || (targetDefinitions.length > 0 && targetDefinitions.some(t => t.targetId === a.targetId && t.unit !== a.unit)))) {
    return invalid("Measurement actuals contain duplicate, out-of-scope, or malformed records.");
  }
  if (targets.some(id => !actuals.some(a => a.targetId === id))) return missing("A selected measurement target has no recorded actual.");
  return pass("Every selected SETUP-018 target has a bound actual measurement, including genuine zero values.");
}

function exc(catalog: WebinarStandardCatalog, c: EvaluationContext, s: CompletionStageContext): RuleFinding {
  const bad = common(c, s);
  if (bad) return bad;
  const exceptions = s.exceptions ?? s.findingEvidence?.exceptions;
  const sourceFindings = s.sourceFindings ?? s.findingEvidence?.sourceFindings;
  if (!exceptions || !s.exceptionClaims || !sourceFindings) return na("No exception inventory was supplied.");
  const claims = s.exceptionClaims;
  if (!s.exceptionProvenance || s.exceptionProvenance.length !== claims.length
    || s.exceptionProvenance.some(p => p.eventId !== c.event.eventId || p.occurrenceId !== s.occurrenceId
      || !text(p.originalFindingId) || p.originalStatus !== "fail" || p.originalStandardId !== catalog.standardId
      || p.originalStandardVersion !== catalog.standardVersion
      || !claims.some(cl => cl.exceptionId === p.exceptionId && cl.ruleId === p.ruleId)
      || sourceFindings.filter(f => f.ruleId === p.ruleId && f.status === "fail" && f.reason === "violation")
        .every(f => !f.evidence.includes(p.originalFindingId)))) {
    return fail("Exception provenance must bind the webinar, occurrence, and preserved original finding.");
  }
  if (new Set(s.exceptionProvenance.map(p => `${p.exceptionId}:${p.ruleId}:${p.originalFindingId}`)).size
    !== s.exceptionProvenance.length) return invalid("Exception provenance contains duplicate bindings.");
  for (const claim of claims) {
    const rule = catalog.rules.find(r => r.ruleId === claim.ruleId);
    const finding = sourceFindings.find(f => f.ruleId === claim.ruleId && f.status === "fail" && f.reason === "violation");
    if (!rule || !rule.exceptionEligible || !finding || claim.ruleId === "WEB-EXC-001") {
      return fail("Exception claim must reference a real failed eligible blocking rule.");
    }
  }
  const checked = exceptions.map((x: unknown) => {
    const id = typeof x === "object" && x !== null && "exceptionId" in x ? (x as { exceptionId?: unknown }).exceptionId : null;
    const claim = s.exceptionClaims!.find(cl => cl.exceptionId === id);
    return claim ? validateWebinarException(x, catalog, c.observedAtEpochMs, claim.ruleId as RuleId) : null;
  });
  if (checked.some(x => x && !x.ok)) return fail("An invoked exception is invalid; the original finding remains active.");
  const resolved = resolveClaims(s.exceptionClaims, exceptions, catalog, sourceFindings, [], c.observedAtEpochMs);
  return resolved.issues.length ? fail("Exception resolution claims are invalid or do not reference real failed eligible rules.") : pass("Exception records are valid and remain separate from original findings.");
}

export function createCompletionStageEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<typeof COMPLETION_STAGE_RULE_IDS[number], RuleEvaluator>> {
  const wrap = (fn: (catalog: WebinarStandardCatalog, c: EvaluationContext, s: CompletionStageContext) => RuleFinding): RuleEvaluator =>
    input => {
      const copy = snapshotData(input);
      if (!copy.ok) return invalid("Completion evaluation requires immutable data-only context.");
      const c = copy.value as EvaluationContext;
      const s = stage(c);
      if (!s) return missing("Complete-stage observation context is required.");
      try { return fn(catalog, c, s); } catch { return invalid("Structurally invalid completion-stage context."); }
    };
  return Object.freeze({
    "WEB-RDY-COMP-001": wrap(comp001),
    "WEB-RDY-COMP-002": wrap(comp002),
    "WEB-RDY-COMP-003": wrap(comp003),
    "WEB-RDY-COMP-004": wrap(comp004),
    "WEB-EXC-001": wrap(exc),
  });
}