import assert from "node:assert/strict";
import { test } from "node:test";
import { planWebinarAudience, type WebinarAudienceInput, type WebinarAudiencePlan, type AudienceParticipantInput } from "../../src/lib/webinar-standard-audience";
import { aggregateWebinarReadiness } from "../../src/lib/webinar-standard-readiness";
import { AUDIENCE_BATCH_RULE_IDS, type EvaluationContext, type AudienceCommunicationObservation } from "../../src/lib/webinar-standard-evaluation";
import type { ManualEvidence } from "../../src/lib/webinar-standard-evidence";
import { materialNoticeDeadline, materialNoticeRequired } from "../../src/lib/webinar-standard-evaluation/audience-policy";
import type { MaterialNoticeField } from "../../src/lib/webinar-standard-evaluation/audience-types";
import { catalog, makeContext, registry } from "./fixtures";
import { exception, input as readinessInput } from "../readiness/fixtures";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Id = typeof AUDIENCE_BATCH_RULE_IDS[number];
const hour = 3_600_000, start = Date.parse("2030-02-01T12:00:00Z");
const isReady = (id: Id) => id.startsWith("WEB-RDY");
function fixture(id: Id): Mutable<EvaluationContext> {
  const now = isReady(id) ? start - 48 * hour : start - hour / 2;
  const registration = id === "WEB-REG-008" ? start - 2 * hour : start - 72 * hour;
  const cancelled = id === "WEB-FU-CAN-001" || id === "WEB-FU-CAN-002";
  const waitlisted = id.startsWith("WEB-FU-WL");
  const p: AudienceParticipantInput = {
    participantId: "participant-1", eventId: "event-1", registrationStatus: cancelled ? "cancelled" : waitlisted ? "waitlisted" : "registered",
    attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true,
    contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
    registrationAtEpochMs: waitlisted ? null : registration, attendanceAvailableAtEpochMs: null,
    waitlistedAtEpochMs: waitlisted ? now - hour : null,
    waitlistPromotionTriggeredAtEpochMs: id === "WEB-FU-WL-002" ? now - hour / 4 : null,
    waitlistClosureTriggeredAtEpochMs: id === "WEB-FU-WL-003" ? now - hour / 4 : null,
    participantCancellationTriggeredAtEpochMs: cancelled ? now - hour / 4 : null,
    neutralVariantApproved: false, qaTestSendRequested: false, followUpAssetId: null,
  };
  const input: WebinarAudienceInput = {
    calculationInstantEpochMs: now, timeZone: "UTC", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    event: { eventId: "event-1", operationalStatus: id === "WEB-REG-006" ? "cancelled" : "scheduled",
      startsAtEpochMs: start, endsAtEpochMs: start + hour, actualEndsAtEpochMs: null, observedAtEpochMs: now,
      materialChangeTriggeredAtEpochMs: id === "WEB-REG-005" ? now - hour / 4 : null,
      cancellationTriggeredAtEpochMs: id === "WEB-REG-006" ? now - hour / 4 : null },
    recruitmentTouches: [
      { identity: "recruitment_1", communicationId: "r1" }, { identity: "recruitment_2", communicationId: "r2" },
      { identity: "recruitment_3", communicationId: "r3" }, { identity: "final_recruitment", communicationId: "r4" },
    ], participants: [p],
  };
  const plan = planWebinarAudience(catalog, input);
  const records: AudienceCommunicationObservation[] = [];
  function record(kind: AudienceCommunicationObservation["kind"], at: number, trigger = at) {
    const obligation = plan.participants[0]!.obligations.find(o => o.kind === kind);
    records.push({
      communicationId: obligation?.communicationId ?? JSON.stringify(["audience", p.participantId, kind]),
      kind, customerPath: true, outcome: at > now ? "scheduled" : "delivered", atEpochMs: at,
      triggerAtEpochMs: trigger, calendarIncluded: true, attendanceInformationIncluded: true,
      renderedTimes: [{ text: "12:00", zoneText: "UTC" }], renderVersion: "render-1", cancellationPermission: null,
    });
  }
  switch (id) {
    case "WEB-REG-001": record("registration_confirmation", registration); break;
    case "WEB-REG-002": record("calendar_information", registration); record("registration_confirmation", registration); break;
    case "WEB-REG-003": record("reminder_24_hour", start - 24 * hour); break;
    case "WEB-REG-004": record("reminder_1_hour", start - hour); break;
    case "WEB-REG-005": record("event_change_notice", now, input.event.materialChangeTriggeredAtEpochMs!); break;
    case "WEB-REG-006": record("event_cancellation_notice", now, input.event.cancellationTriggeredAtEpochMs!); break;
    case "WEB-REG-007": record("registration_confirmation", registration); break;
    case "WEB-REG-008": record("registration_confirmation", registration); record("reminder_1_hour", start - hour); break;
    case "WEB-FU-WL-001": record("waitlist_confirmation", p.waitlistedAtEpochMs!); break;
    case "WEB-FU-WL-002": record("waitlist_promotion", now, p.waitlistPromotionTriggeredAtEpochMs!); break;
    case "WEB-FU-WL-003": record("waitlist_closure", now, p.waitlistClosureTriggeredAtEpochMs!); break;
    case "WEB-FU-CAN-001": record("participant_cancellation_confirmation", now, p.participantCancellationTriggeredAtEpochMs!); break;
  }
  const manual: ManualEvidence = {
    evidenceId: `evidence-${id}`, ruleId: id, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: "confirmed", evidenceDescription: "Complete operational source ledger reviewed.",
    suppliedBy: { nameOrPilotIdentifier: "pilot-reviewer", identityVerified: false }, suppliedAtEpochMs: now,
    sourceReference: "ref:event:event-1:source-1", attachmentReference: null, validFromEpochMs: now, expiresAtEpochMs: null,
    notes: "No identity verification or execution authority.",
    scope: { eventId: "event-1", sessionIds: ["occurrence-1"], participantIds: ["participant-1"],
      communicationIds: records.map(r => r.communicationId), deliverableIds: [] },
    binding: { inputSnapshotVersion: "snapshot-1", artifactVersion: null, reviewedAtEpochMs: now,
      snapshotCompleteness: "complete", observationFromEpochMs: start - 100 * hour, observationThroughEpochMs: now },
  };
  const c: EvaluationContext = {
    ...makeContext(), observedAtEpochMs: now,
    event: { eventId: "event-1", operationalStatus: input.event.operationalStatus, startsAtEpochMs: start },
    participant: { ...makeContext().participant!, registrationStatus: p.registrationStatus },
    audience: {
      occurrenceId: "occurrence-1", input, plan, evaluationStage: id === "WEB-RDY-REC-004" ? "Ready to recruit" : "Ready to run",
      operational: {
        snapshotId: "snapshot-1", occurrenceId: "occurrence-1", observedAtEpochMs: now, participantId: p.participantId,
        ruleId: id, complete: true, evidence: manual, communications: records,
        materialChanges: id === "WEB-REG-005" || id === "WEB-REG-006"
          ? [{ field: id === "WEB-REG-005" ? "platform" : "cancellation", participantFacingPublished: false, changedAtEpochMs: now - hour / 4 }] : [],
        recipientHistory: [{ fromEpochMs: start - 100 * hour, throughEpochMs: null,
          registrationStatus: p.registrationStatus, audienceClass: p.audienceClass, eventStatus: input.event.operationalStatus }],
      },
      configuration: isReady(id) ? {
        snapshotId: "snapshot-1", occurrenceId: "occurrence-1", observedAtEpochMs: now, complete: true,
        evidence: { ...manual, scope: { ...manual.scope, participantIds: [], communicationIds: id === "WEB-RDY-REC-004" ? ["confirmation-config"] : ["24-config", "1-config"] } },
        entries: id === "WEB-RDY-REC-004" ? [{ kind: "registration_confirmation", communicationId: "confirmation-config",
          disposition: "configured", immediate: true, nominalAtEpochMs: null }]
          : [{ kind: "reminder_24_hour", communicationId: "24-config", disposition: "configured", immediate: false, nominalAtEpochMs: start - 24 * hour },
            { kind: "reminder_1_hour", communicationId: "1-config", disposition: "configured", immediate: false, nominalAtEpochMs: start - hour }],
        prerequisiteResults: [],
      } : null,
    },
  };
  if (id === "WEB-REG-008") {
    const basis = { ...input, calculationInstantEpochMs: registration, event: { ...input.event, observedAtEpochMs: registration } };
    (c.audience as Mutable<NonNullable<EvaluationContext["audience"]>>).registrationBasis = {
      input: structuredClone(basis) as Mutable<WebinarAudienceInput>,
      plan: structuredClone(planWebinarAudience(catalog, basis)) as Mutable<WebinarAudiencePlan>,
    };
  }
  if (id === "WEB-REG-007") (records[0] as Mutable<AudienceCommunicationObservation>).renderedEvidence = {
    ...structuredClone(manual), evidenceId: "render-evidence-1",
    binding: { ...manual.binding, artifactVersion: "render-1" },
  } as Mutable<ManualEvidence>;
  return structuredClone(c) as Mutable<EvaluationContext>;
}
function evaluate(id: Id, c = fixture(id)) { return registry.evaluate(id, c); }
function proof(c: Mutable<EvaluationContext>, id: Id) {
  return isReady(id) ? c.audience!.configuration!.evidence : c.audience!.operational!.evidence;
}
function replan(c: Mutable<EvaluationContext>) {
  c.audience!.plan = structuredClone(planWebinarAudience(catalog, c.audience!.input)) as Mutable<WebinarAudiencePlan>;
}
function rescope(c: Mutable<EvaluationContext>) {
  c.audience!.operational!.evidence.scope.communicationIds = [...new Set(c.audience!.operational!.communications.map(r => r.communicationId))];
}

for (const id of AUDIENCE_BATCH_RULE_IDS) {
  test(`${id}: complete scoped operational/configuration evidence passes`, () => assert.equal(evaluate(id).status, "pass"));
  test(`${id}: missing audience context is unavailable, never a pass`, () => {
    const c = fixture(id); c.audience = null; assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: planner obligations alone are not evidence of operation`, () => {
    const c = fixture(id); if (isReady(id)) c.audience!.configuration = null; else c.audience!.operational = null;
    assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
  for (const status of ["incomplete", "unavailable"] as const) test(`${id}: ${status} proof cannot pass`, () => {
    const c = fixture(id); proof(c, id).evidenceStatus = status; assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: valid rejected evidence is a genuine failure`, () => {
    const c = fixture(id); proof(c, id).evidenceStatus = "rejected"; assert.equal(evaluate(id, c).reason, "violation");
  });
  for (const field of ["standardId", "standardVersion"] as const) {
    test(`${id}: wrong ${field} on audience plan is invalid`, () => {
      const c = fixture(id); (c.audience!.plan[field] as string) = "wrong"; assert.equal(evaluate(id, c).reason, "invalid_context");
    });
    test(`${id}: wrong ${field} on operational evidence is invalid`, () => {
      const c = fixture(id); (proof(c, id)[field] as string) = "wrong"; assert.equal(evaluate(id, c).reason, "invalid_context");
    });
  }
  test(`${id}: mis-scoped occurrence cannot satisfy evidence`, () => {
    const c = fixture(id); proof(c, id).scope.sessionIds = ["another-occurrence"]; assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: mis-scoped participant cannot satisfy evidence`, () => {
    const c = fixture(id); proof(c, id).scope.participantIds = ["another-participant"]; assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: expired evidence is invalid before rejected facts can fail policy`, () => {
    const c = fixture(id); proof(c, id).evidenceStatus = "rejected"; proof(c, id).expiresAtEpochMs = c.observedAtEpochMs - 1;
    assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: supplier cannot claim verified identity`, () => {
    const c = fixture(id); (proof(c, id).suppliedBy.identityVerified as boolean) = true; assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: source reference is required`, () => {
    const c = fixture(id); proof(c, id).sourceReference = null; assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: incomplete snapshot defeats apparent failing facts`, () => {
    const c = fixture(id); proof(c, id).binding.snapshotCompleteness = "partial"; proof(c, id).evidenceStatus = "rejected";
    assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: malformed null input is invalid without throwing`, () => {
    const c = fixture(id); c.audience!.input = null as never; assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  if (!isReady(id)) {
    test(`${id}: internal/test labelled QA remains non-customer and not applicable`, () => {
      const c = fixture(id); c.participant!.audienceClass = "test"; c.audience!.input.participants[0]!.audienceClass = "test";
      c.audience!.input.participants[0]!.qaTestSendRequested = true; replan(c);
      c.audience!.operational!.communications = []; rescope(c); c.audience!.operational!.recipientHistory[0]!.audienceClass = "test";
      assert.equal(evaluate(id, c).status, "not_applicable");
    });
    test(`${id}: unknown incomplete ledger cannot turn failing customer path into violation`, () => {
      const c = fixture(id); c.audience!.operational!.complete = false; assert.equal(evaluate(id, c).status, "evidence_unavailable");
    });
    test(`${id}: wrong selected participant is invalid`, () => {
      const c = fixture(id); c.participant!.participantId = "other"; assert.equal(evaluate(id, c).reason, "invalid_context");
    });
  } else {
    test(`${id}: another canonical readiness stage is not applicable`, () => {
      const c = fixture(id); c.audience!.evaluationStage = "Complete"; assert.equal(evaluate(id, c).status, "not_applicable");
    });
    test(`${id}: arbitrary stage is invalid`, () => {
      const c = fixture(id); c.audience!.evaluationStage = "Setup"; assert.equal(evaluate(id, c).reason, "invalid_context");
    });
    test(`${id}: missing stage is unavailable`, () => {
      const c = fixture(id); c.audience!.evaluationStage = null; assert.equal(evaluate(id, c).status, "evidence_unavailable");
    });
    test(`${id}: malformed prerequisite is invalid`, () => {
      const c = fixture(id); c.audience!.configuration!.prerequisiteResults = [null as never]; assert.equal(evaluate(id, c).reason, "invalid_context");
    });
    test(`${id}: missing configured communication fails with complete evidence`, () => {
      const c = fixture(id); c.audience!.configuration!.entries = []; proof(c, id).scope.communicationIds = [];
      assert.equal(evaluate(id, c).reason, "violation");
    });
  }
}

for (const id of AUDIENCE_BATCH_RULE_IDS.filter(id => !isReady(id))) {
  test(`${id}: duplicate ledger entries rejected`, () => {
    const c = fixture(id); const s = c.audience!.operational!;
    if (!s.communications.length) {
      s.communications = fixture("WEB-REG-001").audience!.operational!.communications;
      s.communications[0]!.outcome = "suppressed"; rescope(c);
    }
    s.communications.push(structuredClone(s.communications[0]!));
    assert.equal(evaluate(id, c).reason, "invalid_context");
  });
  test(`${id}: contradictory overlapping historical recipient observations rejected`, () => {
    const c = fixture(id); const s = c.audience!.operational!; s.recipientHistory.push(structuredClone(s.recipientHistory[0]!));
    assert.equal(evaluate(id, c).reason, "invalid_context");
  });
}

test("REG001: registration immediately suppresses every future recruitment recipient path", () => {
  const c = fixture("WEB-REG-001"); const s = c.audience!.operational!;
  s.communications.push({ ...s.communications[0]!, communicationId: "r1", kind: "recruitment", atEpochMs: c.observedAtEpochMs }); rescope(c);
  assert.equal(evaluate("WEB-REG-001", c).reason, "violation");
});
test("REG001: delayed confirmation is not immediate", () => {
  const c = fixture("WEB-REG-001"); c.audience!.operational!.communications[0]!.atEpochMs++;
  assert.equal(evaluate("WEB-REG-001", c).reason, "violation");
});
for (const field of ["calendarIncluded", "attendanceInformationIncluded"] as const) test(`REG002: missing delivered ${field} fails`, () => {
  const c = fixture("WEB-REG-002"); c.audience!.operational!.communications[0]![field] = false;
  assert.equal(evaluate("WEB-REG-002", c).reason, "violation");
});
for (const id of ["WEB-REG-003", "WEB-REG-004"] as const) {
  test(`${id}: later replanning does not erase a past required reminder`, () => {
    const c = fixture(id);
    assert.equal(c.audience!.plan.participants[0]!.obligations.find(o => o.kind === (id === "WEB-REG-003" ? "reminder_24_hour" : "reminder_1_hour"))!.disposition, "omitted");
    c.audience!.operational!.communications = []; rescope(c); assert.equal(evaluate(id, c).reason, "violation");
  });
  test(`${id}: historical proof works after deadline despite planner omission`, () => assert.equal(evaluate(id).status, "pass"));
  test(`${id}: missing historical recipient proof is unavailable`, () => {
    const c = fixture(id); c.audience!.operational!.recipientHistory = []; assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
  test(`${id}: current cancellation cannot erase earlier reminder obligation`, () => {
    const c = fixture(id), cancel = c.observedAtEpochMs - 1;
    c.participant!.registrationStatus = "cancelled";
    c.audience!.input.participants[0]!.registrationStatus = "cancelled";
    c.audience!.input.participants[0]!.participantCancellationTriggeredAtEpochMs = cancel;
    const h = c.audience!.operational!.recipientHistory[0]!; h.throughEpochMs = cancel;
    c.audience!.operational!.recipientHistory.push({ ...h, fromEpochMs: cancel, throughEpochMs: null, registrationStatus: "cancelled" });
    replan(c); assert.equal(evaluate(id, c).status, "pass");
  });
  test(`${id}: registration after nominal reminder cannot receive that reminder`, () => {
    const c = fixture(id); c.audience!.input.participants[0]!.registrationAtEpochMs = c.observedAtEpochMs - 1; replan(c);
    assert.equal(evaluate(id, c).reason, "violation");
  });
}
test("REG007: actual rendered time without adjacent zone fails despite time-zone input data", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedTimes[0]!.zoneText = null;
  assert.equal(evaluate("WEB-REG-007", c).reason, "violation");
});
test("REG007: rendered artifact version missing is unavailable", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderVersion = null;
  assert.equal(evaluate("WEB-REG-007", c).status, "evidence_unavailable");
});
test("REG007: every occurrence is checked, not only the first time", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedTimes.push({ text: "13:00", zoneText: null });
  assert.equal(evaluate("WEB-REG-007", c).reason, "violation");
});
test("REG008: retained registration plan survives current reminder omission", () => assert.equal(evaluate("WEB-REG-008").status, "pass"));
test("REG008: current plan alone cannot replace immutable registration basis", () => {
  const c = fixture("WEB-REG-008"); c.audience!.registrationBasis = null; assert.equal(evaluate("WEB-REG-008", c).status, "evidence_unavailable");
});
test("REG008: operationally missing elapsed reminder remains failure after replan", () => {
  const c = fixture("WEB-REG-008"); c.audience!.operational!.communications.pop(); rescope(c);
  assert.equal(evaluate("WEB-REG-008", c).reason, "violation");
});
test("REG008: reminder at event start fails", () => {
  const c = fixture("WEB-REG-008"); c.audience!.operational!.communications[1]!.atEpochMs = start;
  c.audience!.operational!.communications[1]!.outcome = "scheduled";
  assert.equal(evaluate("WEB-REG-008", c).reason, "violation");
});

const always: MaterialNoticeField[] = ["cancellation", "event_date", "start_time", "end_time", "time_zone", "format", "venue", "location", "platform", "join_link", "access_instructions"];
const published: MaterialNoticeField[] = ["title", "topic", "speakers", "agenda", "access_requirements"];
const internal: MaterialNoticeField[] = ["internal_owner", "internal_notes", "measurement_configuration", "internal_administration"];
for (const field of always) test(`D2: ${field} independently always material`, () => {
  assert.equal(materialNoticeRequired({ field, participantFacingPublished: false, changedAtEpochMs: start }), true);
  const id = field === "cancellation" ? "WEB-REG-006" : "WEB-REG-005";
  const c = fixture(id); c.audience!.operational!.materialChanges[0]!.field = field;
  assert.equal(evaluate(id, c).status, "pass");
});
for (const field of published) {
  test(`D2: published ${field} requires actual notice`, () => {
    const c = fixture("WEB-REG-005"); Object.assign(c.audience!.operational!.materialChanges[0]!, { field, participantFacingPublished: true });
    assert.equal(evaluate("WEB-REG-005", c).status, "pass");
  });
  test(`D2: unpublished ${field} does not trigger customer notice`, () => {
    const c = fixture("WEB-REG-005"); c.audience!.operational!.materialChanges[0]!.field = field;
    c.audience!.input.event.materialChangeTriggeredAtEpochMs = null; replan(c);
    assert.equal(evaluate("WEB-REG-005", c).status, "not_applicable");
  });
}
for (const field of internal) test(`D2: ${field} alone never creates participant notice`, () => {
  assert.equal(materialNoticeRequired({ field, participantFacingPublished: true, changedAtEpochMs: start }), false);
});
for (const id of ["WEB-REG-005", "WEB-REG-006"] as const) {
  for (const [label, elapsed, status] of [["just before one hour", hour - 1, "pass"], ["exactly one hour", hour, "pass"], ["just after one hour", hour + 1, "fail"]] as const) {
    test(`${id}: ${label} measured from explicit change instant`, () => {
      const c = fixture(id), trigger = c.observedAtEpochMs - elapsed;
      const s = c.audience!.operational!; s.materialChanges[0]!.changedAtEpochMs = trigger;
      s.communications[0]!.triggerAtEpochMs = trigger;
      if (id === "WEB-REG-005") c.audience!.input.event.materialChangeTriggeredAtEpochMs = trigger;
      else c.audience!.input.event.cancellationTriggeredAtEpochMs = trigger;
      replan(c); assert.equal(evaluate(id, c).status, status);
    });
  }
  test(`${id}: delivery receipt missing is not a pass`, () => {
    const c = fixture(id); c.audience!.operational = null; assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
}

test("REG008: remaining reminder must be a customer-path delivery", () => {
  const c = fixture("WEB-REG-008"); c.audience!.operational!.communications[1]!.customerPath = false;
  assert.equal(evaluate("WEB-REG-008", c).reason, "violation");
});
test("REG008: remaining reminder receipt must bind the exact nominal trigger", () => {
  const c = fixture("WEB-REG-008"); c.audience!.operational!.communications[1]!.triggerAtEpochMs = null;
  assert.equal(evaluate("WEB-REG-008", c).reason, "violation");
});
test("REG002: calendar-only ledger cannot prove with-or-after-confirmation delivery", () => {
  const c = fixture("WEB-REG-002"); c.audience!.operational!.communications.pop(); rescope(c);
  assert.equal(evaluate("WEB-REG-002", c).reason, "violation");
});
test("REG002: failed confirmation does not satisfy calendar ordering", () => {
  const c = fixture("WEB-REG-002"); c.audience!.operational!.communications[1]!.outcome = "failed";
  assert.equal(evaluate("WEB-REG-002", c).reason, "violation");
});
test("REG002: calendar before actual confirmation fails", () => {
  const c = fixture("WEB-REG-002"); c.audience!.operational!.communications[1]!.atEpochMs++;
  assert.equal(evaluate("WEB-REG-002", c).reason, "violation");
});
test("REG002: flags belong to the trigger-matched calendar receipt, not the first calendar by kind", () => {
  const c = fixture("WEB-REG-002"), records = c.audience!.operational!.communications;
  const wrongTrigger = structuredClone(records[0]!); wrongTrigger.triggerAtEpochMs! -= 1;
  records[0]!.calendarIncluded = false; records.unshift(wrongTrigger); rescope(c);
  assert.equal(evaluate("WEB-REG-002", c).reason, "violation");
});
for (const id of ["WEB-REG-003", "WEB-REG-004", "WEB-REG-005", "WEB-REG-006"] as const) {
  for (const actual of [true, false]) test(`${id}: historical customer ${actual ? "receipt" : "missing receipt"} survives current internal reclassification`, () => {
    const c = fixture(id), transition = c.observedAtEpochMs - 1;
    const records = c.audience!.operational!.communications;
    // Material notices are delivered after their trigger but before reclassification.
    if (id === "WEB-REG-005" || id === "WEB-REG-006") records[0]!.atEpochMs = transition - 1;
    c.participant!.audienceClass = "internal"; c.audience!.input.participants[0]!.audienceClass = "internal";
    const h = c.audience!.operational!.recipientHistory[0]!; h.throughEpochMs = transition;
    c.audience!.operational!.recipientHistory.push({ ...h, fromEpochMs: transition, throughEpochMs: null, audienceClass: "internal" });
    if (!actual) { c.audience!.operational!.communications = []; rescope(c); }
    replan(c);
    assert.equal(evaluate(id, c).status, actual ? "pass" : "fail");
  });
}
test("REG003: current internal classification without historical audience proof cannot erase customer obligations", () => {
  const c = fixture("WEB-REG-003"); c.participant!.audienceClass = "internal";
  c.audience!.input.participants[0]!.audienceClass = "internal"; c.audience!.operational!.recipientHistory = [];
  c.audience!.operational!.communications = []; rescope(c); replan(c);
  assert.equal(evaluate("WEB-REG-003", c).status, "evidence_unavailable");
});
test("REG008: registration after nominal one-hour reminder receives only confirmation, never past reminders", () => {
  const c = fixture("WEB-REG-008"), registration = start - hour * 0.75;
  c.audience!.input.participants[0]!.registrationAtEpochMs = registration;
  const basis = c.audience!.registrationBasis!;
  basis.input.participants[0]!.registrationAtEpochMs = registration;
  basis.input.calculationInstantEpochMs = registration; basis.input.event.observedAtEpochMs = registration;
  basis.plan = structuredClone(planWebinarAudience(catalog, basis.input)) as Mutable<WebinarAudiencePlan>;
  const confirmation = c.audience!.operational!.communications[0]!;
  confirmation.triggerAtEpochMs = registration; confirmation.atEpochMs = registration;
  c.audience!.operational!.communications = [confirmation]; rescope(c); replan(c);
  assert.equal(evaluate("WEB-REG-008", c).status, "pass");
});
test("REG007: arbitrary nonempty rendered zone label is not proof of correct event zone", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedTimes[0]!.zoneText = "Mars/Incorrect";
  assert.equal(evaluate("WEB-REG-007", c).reason, "violation");
});
test("REG007: a different valid IANA zone is still incorrect for this event", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedTimes[0]!.zoneText = "America/New_York";
  assert.equal(evaluate("WEB-REG-007", c).reason, "violation");
});
for (const id of ["WEB-REG-005", "WEB-REG-006"] as const) {
  test(`${id}: change and actual notice exactly at event start meet literal D2 cap`, () => {
    const c = fixture(id), now = start;
    c.observedAtEpochMs = now; c.audience!.input.calculationInstantEpochMs = now; c.audience!.input.event.observedAtEpochMs = now;
    const s = c.audience!.operational!; s.observedAtEpochMs = now; s.evidence.binding.observationThroughEpochMs = now;
    s.evidence.binding.reviewedAtEpochMs = now; s.materialChanges[0]!.changedAtEpochMs = now;
    s.communications[0]!.triggerAtEpochMs = now; s.communications[0]!.atEpochMs = now;
    if (id === "WEB-REG-005") c.audience!.input.event.materialChangeTriggeredAtEpochMs = now;
    else c.audience!.input.event.cancellationTriggeredAtEpochMs = now;
    replan(c); assert.equal(evaluate(id, c).status, "pass");
  });
  test(`${id}: already-overdue post-start trigger with unavailable proof cannot become a proven failure`, () => {
    const c = fixture(id), now = start + hour;
    c.observedAtEpochMs = now; c.audience!.input.calculationInstantEpochMs = now; c.audience!.input.event.observedAtEpochMs = now;
    if (id === "WEB-REG-005") c.audience!.input.event.materialChangeTriggeredAtEpochMs = start + 1;
    else c.audience!.input.event.cancellationTriggeredAtEpochMs = start + 1;
    c.audience!.operational = null; replan(c); assert.equal(evaluate(id, c).status, "evidence_unavailable");
  });
}
test("D2: event beginning sooner caps one elapsed hour", () => assert.equal(materialNoticeDeadline(start - 1000, start), start));
test("D2: event farther away uses one elapsed hour", () => assert.equal(materialNoticeDeadline(start - 2 * hour, start), start - hour));
for (const id of ["WEB-FU-WL-002", "WEB-FU-WL-003"] as const) test(`${id}: promotion/closure is not inferred without explicit trigger`, () => {
  const c = fixture(id);
  if (id === "WEB-FU-WL-002") c.audience!.input.participants[0]!.waitlistPromotionTriggeredAtEpochMs = null;
  else c.audience!.input.participants[0]!.waitlistClosureTriggeredAtEpochMs = null;
  replan(c); assert.equal(evaluate(id, c).status, "not_applicable");
});
test("CAN001: participant cancellation does not change event status", () => {
  const c = fixture("WEB-FU-CAN-001"); assert.equal(c.event.operationalStatus, "scheduled"); assert.equal(evaluate("WEB-FU-CAN-001", c).status, "pass");
});
test("CAN002: post-cancellation customer communication is forbidden without explicit permission", () => {
  const c = fixture("WEB-FU-CAN-002"); const r = fixture("WEB-REG-004").audience!.operational!.communications[0]!;
  r.atEpochMs = c.observedAtEpochMs; c.audience!.operational!.communications.push(r); rescope(c);
  assert.equal(evaluate("WEB-FU-CAN-002", c).reason, "violation");
});
test("CAN002: unavailable permission cannot certify permitted send", () => {
  const c = fixture("WEB-FU-CAN-002"); const r = fixture("WEB-REG-004").audience!.operational!.communications[0]!;
  r.atEpochMs = c.observedAtEpochMs; c.audience!.operational!.communications.push(r); rescope(c);
  r.cancellationPermission = { ...structuredClone(c.audience!.operational!.evidence), evidenceId: "permission-1", evidenceStatus: "unavailable" };
  assert.equal(evaluate("WEB-FU-CAN-002", c).status, "evidence_unavailable");
});
test("CAN002: independent explicitly reviewed policy permission can permit the exact communication", () => {
  const c = fixture("WEB-FU-CAN-002"); const r = fixture("WEB-REG-004").audience!.operational!.communications[0]!;
  r.atEpochMs = c.observedAtEpochMs; c.audience!.operational!.communications.push(r); rescope(c);
  r.cancellationPermission = { ...structuredClone(c.audience!.operational!.evidence), evidenceId: "permission-1", evidenceDescription: "Reviewed approved policy specifically permits this communication after cancellation." };
  assert.equal(evaluate("WEB-FU-CAN-002", c).status, "pass");
});

for (const id of AUDIENCE_BATCH_RULE_IDS) {
  for (const scenario of ["missing", "invalid", "failure"] as const) {
    test(`${id}: ${scenario} evidence and exception resolution remain distinct`, () => {
      const c = fixture(id);
      if (scenario === "missing") proof(c, id).evidenceStatus = "unavailable";
      else if (scenario === "invalid") proof(c, id).scope.eventId = "wrong-event";
      else proof(c, id).evidenceStatus = "rejected";
      const original = evaluate(id, c), rule = original.rule;
      const record = exception(rule, { createdAtEpochMs: c.observedAtEpochMs - 200,
        decisionAtEpochMs: c.observedAtEpochMs - 100, expiresAtEpochMs: c.observedAtEpochMs + hour });
      const report = aggregateWebinarReadiness(catalog, registry, readinessInput({
        evaluationTimeEpochMs: c.observedAtEpochMs, results: [original], exceptions: [record],
        exceptionClaims: [{ ruleId: id, exceptionId: record.exceptionId }],
      }));
      const resolved = report.stages.flatMap(s => s.exceptionResolvedBlockers);
      const eligible = scenario === "failure" && (id === "WEB-FU-WL-002" || id === "WEB-FU-WL-003");
      assert.equal(resolved.length, eligible ? 1 : 0);
      if (eligible) { assert.deepEqual(resolved[0]!.originalFailure, original); assert.equal(resolved[0]!.classification, "resolvedByException"); }
      assert.deepEqual(evaluate(id, c), original);
    });
  }
}
for (const id of ["WEB-FU-WL-001", "WEB-FU-WL-002", "WEB-FU-WL-003", "WEB-FU-CAN-001"] as const) {
  test(`${id}: a reviewed failed actual send is a policy violation`, () => {
    const c = fixture(id); c.audience!.operational!.communications[0]!.outcome = "failed";
    assert.equal(evaluate(id, c).reason, "violation");
  });
  test(`${id}: scheduled communication is not actual delivery`, () => {
    const c = fixture(id); c.audience!.operational!.communications[0]!.outcome = "scheduled";
    assert.equal(evaluate(id, c).reason, "violation");
  });
}
test("REG007: time-and-zone data plus render-version string is not rendered proof", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedEvidence = null;
  assert.equal(evaluate("WEB-REG-007", c).status, "evidence_unavailable");
});
test("REG007: rendered proof must bind the actual artifact version", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedEvidence!.binding.artifactVersion = "another";
  assert.equal(evaluate("WEB-REG-007", c).reason, "invalid_context");
});
test("REG007: complete rendering without event time is not a missing-time failure", () => {
  const c = fixture("WEB-REG-007"); c.audience!.operational!.communications[0]!.renderedTimes = [];
  assert.equal(evaluate("WEB-REG-007", c).status, "pass");
});
test("RDY REC004: delivery proof cannot replace actual confirmation configuration", () => {
  const c = fixture("WEB-RDY-REC-004"); c.audience!.configuration = null;
  c.audience!.operational = fixture("WEB-REG-001").audience!.operational;
  assert.equal(evaluate("WEB-RDY-REC-004", c).status, "evidence_unavailable");
});
test("RDY REC004: non-immediate configuration fails even with confirmed evidence", () => {
  const c = fixture("WEB-RDY-REC-004"); c.audience!.configuration!.entries[0]!.immediate = false;
  assert.equal(evaluate("WEB-RDY-REC-004", c).reason, "violation");
});
test("RDY RUN005: future reminder cannot be silently omitted", () => {
  const c = fixture("WEB-RDY-RUN-005"); c.audience!.configuration!.entries[0]!.disposition = "omitted";
  assert.equal(evaluate("WEB-RDY-RUN-005", c).reason, "violation");
});
test("RDY RUN005: past-due reminders are validly omitted rather than backdated", () => {
  const c = fixture("WEB-RDY-RUN-005"), now = start - hour / 2;
  c.observedAtEpochMs = now; c.audience!.input.calculationInstantEpochMs = now; c.audience!.input.event.observedAtEpochMs = now;
  c.audience!.configuration!.observedAtEpochMs = now;
  for (const e of c.audience!.configuration!.entries) e.disposition = "omitted";
  replan(c); assert.equal(evaluate("WEB-RDY-RUN-005", c).status, "pass");
});
for (const id of ["WEB-RDY-REC-004", "WEB-RDY-RUN-005"] as const) {
  test(`${id}: invalid-context canonical prerequisite cannot be treated as a failed blocker`, () => {
    const c = fixture(id), prerequisiteId = id === "WEB-RDY-REC-004" ? "WEB-REG-001" : "WEB-REG-003";
    const invalidC = fixture(prerequisiteId); invalidC.audience!.occurrenceId = "";
    c.audience!.configuration!.prerequisiteResults = [{ ...evaluate(prerequisiteId, invalidC), participantId: null }] as never;
    assert.equal(evaluate(id, c).reason, "invalid_context");
  });
}
for (const id of ["WEB-REG-005", "WEB-REG-006"] as const) {
  for (const [label, deliveryOffset, expected] of [["exact event-start cap", 0, "pass"], ["one millisecond beyond event-start cap", 1, "fail"]] as const) {
    test(`${id}: ${label}`, () => {
      const c = fixture(id), now = start + 10, trigger = start - hour / 2;
      c.observedAtEpochMs = now; c.audience!.input.calculationInstantEpochMs = now; c.audience!.input.event.observedAtEpochMs = now;
      const s = c.audience!.operational!; s.observedAtEpochMs = now; s.evidence.binding.observationThroughEpochMs = now;
      s.evidence.binding.reviewedAtEpochMs = now; s.evidence.suppliedAtEpochMs = now;
      s.materialChanges[0]!.changedAtEpochMs = trigger; s.communications[0]!.triggerAtEpochMs = trigger;
      s.communications[0]!.atEpochMs = start + deliveryOffset;
      if (id === "WEB-REG-005") c.audience!.input.event.materialChangeTriggeredAtEpochMs = trigger;
      else c.audience!.input.event.cancellationTriggeredAtEpochMs = trigger;
      replan(c); assert.equal(evaluate(id, c).status, expected);
    });
  }
  test(`${id}: after-start trigger is already overdue under the literal event-start cap`, () => {
    const c = fixture(id), now = start + hour;
    c.observedAtEpochMs = now; c.audience!.input.calculationInstantEpochMs = now; c.audience!.input.event.observedAtEpochMs = now;
    const s = c.audience!.operational!; s.observedAtEpochMs = now; s.evidence.binding.observationThroughEpochMs = now;
    s.evidence.binding.reviewedAtEpochMs = now; s.materialChanges[0]!.changedAtEpochMs = start + 1;
    s.communications[0]!.triggerAtEpochMs = start + 1; s.communications[0]!.atEpochMs = start + 2;
    if (id === "WEB-REG-005") c.audience!.input.event.materialChangeTriggeredAtEpochMs = start + 1;
    else c.audience!.input.event.cancellationTriggeredAtEpochMs = start + 1;
    replan(c); assert.equal(evaluate(id, c).reason, "violation");
  });
}