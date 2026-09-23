import assert from "node:assert/strict";
import { test } from "node:test";
import { planWebinarAudience, type AudienceParticipantInput, type WebinarAudienceInput } from "../../src/lib/webinar-standard-audience";
import { planWebinarRecruitment, type RecruitmentPlan } from "../../src/lib/webinar-standard-scheduling";
import {
  SCHEDULING_BATCH_RULE_IDS, type EvaluationContext,
  type RecruitmentSuppressionSnapshot, type SuppressionObservation, type RecruitmentConfigurationSnapshot,
} from "../../src/lib/webinar-standard-evaluation";
import type { ManualEvidence } from "../../src/lib/webinar-standard-evidence";
import { IMPLEMENTED_RULE_IDS } from "../../src/lib/webinar-standard-evaluation/evaluators";
import { isBlockingFailure } from "../../src/lib/webinar-standard-readiness/claims";
import { catalog, makeContext, registry } from "./fixtures";

const start = Date.parse("2030-02-01T12:00:00Z");
const calculation = Date.parse("2030-01-11T12:00:00Z");
const identities = ["recruitment_1", "recruitment_2", "recruitment_3", "final_recruitment"] as const;
const touchIds = identities.map((identity, index) => ({ identity, communicationId: `rec-${index + 1}` }));

function plan(days = 21, status: EvaluationContext["event"]["operationalStatus"] = "scheduled"): RecruitmentPlan {
  return planWebinarRecruitment(catalog, {
    calculationInstantEpochMs: start - days * 86_400_000, webinarStartEpochMs: start,
    timeZone: "UTC", eventStatus: status, standardId: catalog.standardId,
    standardVersion: catalog.standardVersion, touches: touchIds,
  });
}
function context(p = plan()): EvaluationContext {
  const base = makeContext();
  const configuredPlan = {
    snapshotId: "configured-1", occurrenceId: "occurrence-1",
    eventId: "event-1", standardId: catalog.standardId,
    standardVersion: catalog.standardVersion, complete: true,
    touches: p.touches.map(t => ({
      identity: t.identity, communicationId: t.communicationId,
      disposition: t.disposition, scheduledAtEpochMs: t.scheduledAtEpochMs,
    })),
    surfacedWarnings: p.warnings,
  } as const;
  return {
    ...base, observedAtEpochMs: p.calculationInstantEpochMs,
    event: { eventId: "event-1", operationalStatus: p.eventStatus, startsAtEpochMs: p.webinarStartEpochMs },
    scheduling: {
      evaluationStage: "Ready to recruit",
      occurrenceId: "occurrence-1", timeZone: p.timeZone, recruitmentPlan: p,
      configuredPlan,
      creationSnapshot: {
        snapshotId: "creation-1", occurrenceId: "occurrence-1", eventId: "event-1",
        standardId: catalog.standardId, standardVersion: catalog.standardVersion,
        capturedAtEpochMs: p.calculationInstantEpochMs, timeZone: p.timeZone,
        eventStatus: p.eventStatus, recruitmentPlan: p, configuredPlan,
      },
      suppression: null,
      omissionDisplay: {
        evidence: manualEvidence("WEB-WIN-007", p.calculationInstantEpochMs, {
          participantIds: [], communicationIds: p.touches.map(t => t.communicationId),
          inputSnapshotVersion: "configured-1", artifactVersion: "render-v1",
        }),
        occurrenceId: "occurrence-1", configuredSnapshotId: "configured-1", renderVersion: "render-v1",
        entries: p.touches.filter(t => t.disposition === "omitted").map(t => ({
          identity: t.identity, communicationId: t.communicationId,
          label: "omitted-because-past-due" as const, reason: t.reason,
        })),
      },
    },
  };
}

function manualEvidence(
  ruleId: typeof catalog.rules[number]["ruleId"],
  now: number,
  options: {
    participantIds: readonly string[];
    communicationIds: readonly string[];
    inputSnapshotVersion: string;
    artifactVersion: string | null;
    status?: ManualEvidence["evidenceStatus"];
  },
): ManualEvidence {
  return {
    evidenceId: `evidence-${ruleId}-${options.participantIds.join("-") || "event"}`,
    ruleId, standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: options.status ?? "confirmed",
    evidenceDescription: "Current scoped source observation.",
    suppliedBy: { nameOrPilotIdentifier: "source-reviewer", identityVerified: false },
    suppliedAtEpochMs: now, sourceReference: "ref:event:event-1:source-1",
    attachmentReference: null, validFromEpochMs: now, expiresAtEpochMs: null,
    notes: "Read-only evidence without operational authority.",
    scope: {
      eventId: "event-1", sessionIds: ["occurrence-1"],
      participantIds: options.participantIds, communicationIds: options.communicationIds,
      deliverableIds: [],
    },
    binding: {
      inputSnapshotVersion: options.inputSnapshotVersion, artifactVersion: options.artifactVersion,
      reviewedAtEpochMs: now, snapshotCompleteness: "complete",
      observationFromEpochMs: now, observationThroughEpochMs: now,
    },
  };
}

const planningPassCases = [
  ["WEB-REC-001", 21], ["WEB-REC-002", 14], ["WEB-REC-003", 7], ["WEB-REC-004", 1],
  ["WEB-WIN-001", 21], ["WEB-WIN-002", 14], ["WEB-WIN-003", 7],
  ["WEB-WIN-004", 2], ["WEB-WIN-005", 1], ["WEB-RDY-REC-005", 7],
] as const;
for (const ruleId of SCHEDULING_BATCH_RULE_IDS) {
  test(`${ruleId}: wrong standard on supplied scheduler result is rejected`, () => {
    const c = context();
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!,
        recruitmentPlan: { ...c.scheduling!.recruitmentPlan!, standardId: "wrong" as typeof catalog.standardId },
        creationSnapshot: {
          ...c.scheduling!.creationSnapshot!,
          recruitmentPlan: {
            ...c.scheduling!.creationSnapshot!.recruitmentPlan,
            standardId: "wrong" as typeof catalog.standardId,
          },
        },
      },
    }).reason, "invalid_context");
  });
  test(`${ruleId}: wrong version on supplied scheduler result is rejected`, () => {
    const c = context();
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!,
        recruitmentPlan: { ...c.scheduling!.recruitmentPlan!, standardVersion: "wrong" as typeof catalog.standardVersion },
        creationSnapshot: {
          ...c.scheduling!.creationSnapshot!,
          recruitmentPlan: {
            ...c.scheduling!.creationSnapshot!.recruitmentPlan,
            standardVersion: "wrong" as typeof catalog.standardVersion,
          },
        },
      },
    }).reason, "invalid_context");
  });
}
for (const [ruleId, days] of planningPassCases) {
  test(`${ruleId}: exact configured output from the verified scheduler passes`, () => {
    assert.equal(registry.evaluate(ruleId, context(plan(days))).status, "pass");
  });
  test(`${ruleId}: a configured instant differing from scheduler output fails`, () => {
    const c = context(plan(days));
    const index = c.scheduling!.configuredPlan!.touches.findIndex(t => t.disposition !== "omitted");
    const touches = c.scheduling!.configuredPlan!.touches.map((t, i) => i === index
      ? { ...t, scheduledAtEpochMs: t.scheduledAtEpochMs! + 1 } : t);
    const creationBased = ruleId === "WEB-REC-001" || ruleId === "WEB-WIN-001";
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: creationBased ? {
        ...c.scheduling!, creationSnapshot: {
          ...c.scheduling!.creationSnapshot!,
          configuredPlan: { ...c.scheduling!.creationSnapshot!.configuredPlan, touches },
        },
      } : { ...c.scheduling!, configuredPlan: { ...c.scheduling!.configuredPlan!, touches } },
    }).status, "fail");
  });
  test(`${ruleId}: missing scheduler output is evidence unavailable`, () => {
    const c = context(plan(days));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, recruitmentPlan: null, creationSnapshot: null },
    }).status, "evidence_unavailable");
  });
  test(`${ruleId}: wrong scheduler version is invalid context`, () => {
    const c = context(plan(days));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!,
        recruitmentPlan: { ...c.scheduling!.recruitmentPlan!, standardVersion: "wrong" as typeof catalog.standardVersion },
        creationSnapshot: {
          ...c.scheduling!.creationSnapshot!,
          recruitmentPlan: {
            ...c.scheduling!.creationSnapshot!.recruitmentPlan,
            standardVersion: "wrong" as typeof catalog.standardVersion,
          },
        },
      },
    }).reason, "invalid_context");
  });
  test(`${ruleId}: wrong scheduler standard identifier is invalid context`, () => {
    const c = context(plan(days));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!,
        recruitmentPlan: { ...c.scheduling!.recruitmentPlan!, standardId: "wrong" as typeof catalog.standardId },
        creationSnapshot: {
          ...c.scheduling!.creationSnapshot!,
          recruitmentPlan: {
            ...c.scheduling!.creationSnapshot!.recruitmentPlan,
            standardId: "wrong" as typeof catalog.standardId,
          },
        },
      },
    }).reason, "invalid_context");
  });
}

test("WEB-REC-001: shortened-window planner omission is not applicable", () => {
  assert.equal(registry.evaluate("WEB-REC-001", context(plan(14))).status, "not_applicable");
});
test("WEB-REC-002: planner omission in the seven-day band is not applicable", () => {
  assert.equal(registry.evaluate("WEB-REC-002", context(plan(7))).status, "not_applicable");
});
test("WEB-REC-003: inactive-event planner omission is not applicable", () => {
  assert.equal(registry.evaluate("WEB-REC-003", context(plan(0, "completed"))).status, "not_applicable");
});
test("WEB-REC-004: scheduler-approved insufficient separation omission is not applicable", () => {
  const p = planWebinarRecruitment(catalog, {
    calculationInstantEpochMs: Date.parse("2030-01-30T13:00:00Z"), webinarStartEpochMs: start,
    timeZone: "UTC", eventStatus: "scheduled", standardId: catalog.standardId,
    standardVersion: catalog.standardVersion, touches: touchIds,
  });
  assert.equal(p.touches.find(t => t.identity === "final_recruitment")!.reason, "insufficient_24_hour_separation");
  assert.equal(registry.evaluate("WEB-REC-004", context(p)).status, "not_applicable");
});
test("WEB-WIN-001: a different verified scheduler band is not applicable", () => {
  assert.equal(registry.evaluate("WEB-WIN-001", context(plan(14))).status, "not_applicable");
});
test("WEB-WIN-002: a different verified scheduler band is not applicable", () => {
  assert.equal(registry.evaluate("WEB-WIN-002", context(plan(7))).status, "not_applicable");
});
test("WEB-WIN-003: a different verified scheduler band is not applicable", () => {
  assert.equal(registry.evaluate("WEB-WIN-003", context(plan(2))).status, "not_applicable");
});
test("WEB-WIN-004: a different verified scheduler band is not applicable", () => {
  assert.equal(registry.evaluate("WEB-WIN-004", context(plan(1))).status, "not_applicable");
});
test("WEB-WIN-005: a different verified scheduler band is not applicable", () => {
  assert.equal(registry.evaluate("WEB-WIN-005", context(plan(2))).status, "not_applicable");
});
test("WEB-REC-001: later recalculation does not replace the occurrence-creation basis", () => {
  const creation = context(plan(21)).scheduling!.creationSnapshot!;
  const later = context(plan(14));
  assert.equal(registry.evaluate("WEB-REC-001", {
    ...later, scheduling: { ...later.scheduling!, creationSnapshot: creation },
  }).status, "pass");
});
test("WEB-WIN-001: later recalculation does not replace the occurrence-creation band", () => {
  const creation = context(plan(21)).scheduling!.creationSnapshot!;
  const later = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-001", {
    ...later, scheduling: { ...later.scheduling!, creationSnapshot: creation },
  }).status, "pass");
});
for (const ruleId of ["WEB-REC-001", "WEB-WIN-001"] as const) {
  test(`${ruleId}: missing creation basis is evidence unavailable`, () => {
    const c = context();
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, creationSnapshot: null },
    }).status, "evidence_unavailable");
  });
  test(`${ruleId}: mis-scoped creation basis is invalid context`, () => {
    const c = context();
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!, creationSnapshot: {
          ...c.scheduling!.creationSnapshot!, occurrenceId: "other-occurrence",
        },
      },
    }).reason, "invalid_context");
  });
  test(`${ruleId}: wrong-version creation basis is invalid context`, () => {
    const c = context();
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!, creationSnapshot: {
          ...c.scheduling!.creationSnapshot!,
          standardVersion: "wrong" as typeof catalog.standardVersion,
        },
      },
    }).reason, "invalid_context");
  });
}
test("scheduler result claiming send authority is rejected without regeneration", () => {
  const c = context(plan(14));
  assert.equal(registry.evaluate("WEB-WIN-002", {
    ...c, scheduling: {
      ...c.scheduling!,
      recruitmentPlan: { ...c.scheduling!.recruitmentPlan!, sendAuthorized: true as false },
    },
  }).reason, "invalid_context");
});
test("scheduler result with duplicate touch identity is rejected", () => {
  const c = context(plan(14));
  const touches = c.scheduling!.recruitmentPlan!.touches.map((t, i) => i === 1
    ? { ...t, identity: "recruitment_1" as const } : t);
  assert.equal(registry.evaluate("WEB-WIN-002", {
    ...c, scheduling: { ...c.scheduling!, recruitmentPlan: { ...c.scheduling!.recruitmentPlan!, touches } },
  }).reason, "invalid_context");
});
test("evaluator rejects a scheduler result genuinely missing a canonical touch", () => {
  const c = context(plan(14));
  assert.equal(registry.evaluate("WEB-WIN-002", {
    ...c, scheduling: {
      ...c.scheduling!,
      recruitmentPlan: {
        ...c.scheduling!.recruitmentPlan!,
        touches: c.scheduling!.recruitmentPlan!.touches.slice(0, 3),
      } as RecruitmentPlan,
    },
  }).reason, "invalid_context");
});
for (const ruleId of SCHEDULING_BATCH_RULE_IDS) {
  test(`${ruleId}: absent scheduling evidence is unavailable, not an established failure`, () => {
    const c = context();
    assert.equal(registry.evaluate(ruleId, { ...c, scheduling: undefined }).status, "evidence_unavailable");
  });
}

test("malformed configured touch is invalid context instead of throwing", () => {
  const c = context();
  assert.equal(registry.evaluate("WEB-REC-002", {
    ...c, scheduling: {
      ...c.scheduling!, configuredPlan: {
        ...c.scheduling!.configuredPlan!, touches: [null] as unknown as RecruitmentConfigurationSnapshot["touches"],
      },
    },
  }).reason, "invalid_context");
});

test("evaluator rejects a forged full-window final-touch omission", () => {
  const c = context(plan(21));
  const touches = c.scheduling!.creationSnapshot!.recruitmentPlan.touches.map((touch, index) =>
    index === 3 ? {
      ...touch, disposition: "omitted" as const, scheduledAtEpochMs: null,
      eventLocalDate: null, eventLocalTime: null, eventLocalOffset: null,
      reason: "shortened_window_omission" as const,
      timeAdjustment: { disambiguation: "none" as const, requestedLocalDateTime: null },
      ruleIds: ["WEB-REC-004", "WEB-WIN-001", "WEB-WIN-007", "WEB-REC-011"] as const,
    } : touch);
  assert.equal(registry.evaluate("WEB-WIN-001", {
    ...c, scheduling: {
      ...c.scheduling!, creationSnapshot: {
        ...c.scheduling!.creationSnapshot!,
        recruitmentPlan: { ...c.scheduling!.creationSnapshot!.recruitmentPlan, touches },
      },
    },
  }).reason, "invalid_context");
});
test("scheduler result inconsistent with the supplied occurrence is rejected", () => {
  const c = context();
  assert.equal(registry.evaluate("WEB-WIN-001", {
    ...c, event: { ...c.event, startsAtEpochMs: c.event.startsAtEpochMs! + 1 },
  }).reason, "invalid_context");
});
test("blank event identity is invalid before missing operational evidence is considered", () => {
  const c = context();
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, event: { ...c.event, eventId: " " },
  }).reason, "invalid_context");
});
test("invalid observation instant is invalid before missing operational evidence is considered", () => {
  const c = context();
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, observedAtEpochMs: Number.NaN,
  }).reason, "invalid_context");
});
test("invalid IANA zone is rejected by the shared scheduler-result contract", () => {
  const c = context(plan(14));
  assert.equal(registry.evaluate("WEB-WIN-002", {
    ...c, scheduling: { ...c.scheduling!, timeZone: "Not/A_Zone" },
  }).reason, "invalid_context");
});
test("DST adjustment metadata from the scheduler is consumed unchanged", () => {
  const p = planWebinarRecruitment(catalog, {
    calculationInstantEpochMs: Date.parse("2025-02-01T15:30:00Z"),
    webinarStartEpochMs: Date.parse("2025-04-20T00:30:00Z"), timeZone: "Europe/London",
    eventStatus: "scheduled", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    touches: touchIds,
  });
  assert.ok(p.touches.some(t => t.timeAdjustment.disambiguation === "gap_forward"));
  assert.equal(registry.evaluate("WEB-WIN-001", context(p)).status, "pass");
});
test("DST overlap metadata from the scheduler is consumed unchanged", () => {
  const p = planWebinarRecruitment(catalog, {
    calculationInstantEpochMs: Date.parse("2025-09-01T12:00:00Z"),
    webinarStartEpochMs: Date.parse("2025-11-16T06:30:00Z"), timeZone: "America/New_York",
    eventStatus: "scheduled", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    touches: touchIds,
  });
  assert.ok(p.touches.some(t => t.timeAdjustment.disambiguation === "overlap_earlier"));
  assert.equal(registry.evaluate("WEB-WIN-001", context(p)).status, "pass");
});
for (const status of ["in_progress", "completed", "cancelled"] as const) {
  test(`${status} verified scheduler output remains visible and makes touch rules not applicable`, () => {
    assert.equal(registry.evaluate("WEB-REC-003", context(plan(0, status))).status, "not_applicable");
  });
}
for (const [label, calculationInstant, expectedReason] of [
  ["exactly 24 hours", Date.parse("2030-01-30T12:00:00Z"), "standard_offset"],
  ["just under 24 hours", Date.parse("2030-01-30T12:00:00.001Z"), "insufficient_24_hour_separation"],
  ["just over 24 hours", Date.parse("2030-01-30T11:59:59.999Z"), "standard_offset"],
] as const) {
  test(`WEB-WIN-004 consumes scheduler output at ${label} separation`, () => {
    const p = planWebinarRecruitment(catalog, {
      calculationInstantEpochMs: calculationInstant, webinarStartEpochMs: start, timeZone: "UTC",
      eventStatus: "scheduled", standardId: catalog.standardId, standardVersion: catalog.standardVersion,
      touches: touchIds,
    });
    assert.equal(p.touches.find(t => t.identity === "final_recruitment")!.reason, expectedReason);
    assert.equal(registry.evaluate("WEB-WIN-004", context(p)).status, "pass");
  });
}

function audienceInput(overrides: Partial<AudienceParticipantInput>): WebinarAudienceInput {
  return {
    calculationInstantEpochMs: calculation, timeZone: "UTC",
    standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    event: {
      eventId: "event-1", operationalStatus: "scheduled", startsAtEpochMs: start,
      endsAtEpochMs: start + 3_600_000, actualEndsAtEpochMs: null, observedAtEpochMs: calculation,
      materialChangeTriggeredAtEpochMs: null, cancellationTriggeredAtEpochMs: null,
    },
    recruitmentTouches: touchIds,
    participants: [{
      participantId: "p-1", eventId: "event-1", registrationStatus: "not_registered",
      attendanceState: "unknown", audienceClass: "customer", recruitmentEligible: true,
      contactable: true, optedOut: false, invalidAddress: false, governedExclusion: false,
      registrationAtEpochMs: null, attendanceAvailableAtEpochMs: null, waitlistedAtEpochMs: null,
      waitlistPromotionTriggeredAtEpochMs: null, waitlistClosureTriggeredAtEpochMs: null,
      participantCancellationTriggeredAtEpochMs: null, neutralVariantApproved: false,
      qaTestSendRequested: false, followUpAssetId: null, ...overrides,
    }],
  };
}
function suppression(ruleId: SuppressionObservation["ruleId"], overrides: Partial<AudienceParticipantInput>): EvaluationContext {
  const input = audienceInput(overrides);
  const audiencePlan = planWebinarAudience(catalog, input);
  const observation: SuppressionObservation = {
    ruleId, participantId: "p-1",
    evidence: manualEvidence(ruleId, calculation, {
      participantIds: ["p-1"], communicationIds: touchIds.map(t => t.communicationId),
      inputSnapshotVersion: "suppression-1", artifactVersion: null,
    }),
    conditionApplies: true,
    cancellationAtEpochMs: ruleId === "WEB-REC-007" ? calculation - 1_000 : null,
    recipientObservations: touchIds.map(t => ({
      communicationId: t.communicationId, scheduledAtEpochMs: calculation + 1_000, included: false,
    })),
  };
  const prerequisiteResults = ["WEB-REC-005", "WEB-REC-006", "WEB-REC-007", "WEB-REC-008", "WEB-REC-009", "WEB-REC-010"]
    .map(rule => registry.evaluate(rule as typeof catalog.rules[number]["ruleId"], {
      ...makeContext(), participant: null,
    })).map(item => item.ruleId === "WEB-REC-010" ? item : ({
      ...item, status: "pass" as const, reason: "satisfied" as const,
      evidence: [`Synthetic current population-scoped result for ${item.ruleId}.`],
    }));
  const snapshot: RecruitmentSuppressionSnapshot = {
    snapshotId: "suppression-1", occurrenceId: "occurrence-1",
    eventId: "event-1", standardId: catalog.standardId,
    standardVersion: catalog.standardVersion, observedAtEpochMs: calculation,
    completePopulation: true, recruitmentCommunicationIds: touchIds.map(t => t.communicationId),
    audiencePlan, observations: [observation],
    controls: ["WEB-REC-005", "WEB-REC-006", "WEB-REC-007", "WEB-REC-008", "WEB-REC-009", "WEB-REC-010"].map(id => ({
      ruleId: id as typeof catalog.rules[number]["ruleId"],
      evidence: manualEvidence(id as typeof catalog.rules[number]["ruleId"], calculation, {
        participantIds: ["p-1"], communicationIds: touchIds.map(t => t.communicationId),
        inputSnapshotVersion: "suppression-1", artifactVersion: null,
      }),
      active: true,
    })),
    prerequisiteResults,
  };
  const c = context(plan(21));
  return {
    ...c, observedAtEpochMs: calculation,
    event: { ...c.event, startsAtEpochMs: start },
    scheduling: { ...c.scheduling!, suppression: snapshot },
  };
}

const suppressionCases = [
  ["WEB-REC-006", { optedOut: true }],
  ["WEB-REC-007", {
    registrationStatus: "cancelled", registrationAtEpochMs: calculation - 10_000,
    participantCancellationTriggeredAtEpochMs: calculation - 1_000,
  }],
  ["WEB-REC-009", { invalidAddress: true }],
] as const;
for (const [ruleId, participantPatch] of suppressionCases) {
  test(`${ruleId}: complete operational evidence and audience suppression pass`, () => {
    assert.equal(registry.evaluate(ruleId, suppression(ruleId, participantPatch)).status, "pass");
  });
  test(`${ruleId}: configured recipient inclusion fails containment`, () => {
    const c = suppression(ruleId, participantPatch);
    const observations = c.scheduling!.suppression!.observations.map(o => ({
      ...o, recipientObservations: o.recipientObservations.map((recipient, i) =>
        i === 0 ? { ...recipient, included: true } : recipient),
    }));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
    }).status, "fail");
  });
  test(`${ruleId}: partial operational population is evidence unavailable`, () => {
    const c = suppression(ruleId, participantPatch);
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, completePopulation: false } },
    }).status, "evidence_unavailable");
  });
  test(`${ruleId}: wrong-version operational evidence is invalid context`, () => {
    const c = suppression(ruleId, participantPatch);
    const observations = c.scheduling!.suppression!.observations.map(o => ({
      ...o, evidence: {
        ...o.evidence, standardVersion: "wrong" as typeof catalog.standardVersion,
      },
    }));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
    }).reason, "invalid_context");
  });
  test(`${ruleId}: complete evidence with a false trigger is not applicable`, () => {
    const c = suppression(ruleId, participantPatch);
    const observations = c.scheduling!.suppression!.observations.map(o => ({
      ...o, conditionApplies: false, cancellationAtEpochMs: null,
    }));
    const participants = c.scheduling!.suppression!.audiencePlan.participants.map(p => ({
      ...p, suppressions: p.suppressions.filter(reason =>
        !["opted_out", "not_recruitment_eligible", "not_contactable", "participant_state_suppresses_recruitment", "invalid_address"].includes(reason)),
      recruitmentEligible: true,
      recruitmentPlan: c.scheduling!.recruitmentPlan,
    }));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: {
        ...c.scheduling!, suppression: {
          ...c.scheduling!.suppression!,
          observations,
          audiencePlan: { ...c.scheduling!.suppression!.audiencePlan, participants },
        },
      },
    }).status, "not_applicable");
  });
}

test("WEB-REC-007 permits historical recipient inclusion before cancellation", () => {
  const c = suppression("WEB-REC-007", {
    registrationStatus: "cancelled", registrationAtEpochMs: calculation - 10_000,
    participantCancellationTriggeredAtEpochMs: calculation - 1_000,
  });
  const observations = c.scheduling!.suppression!.observations.map(o => ({
    ...o, recipientObservations: o.recipientObservations.map((recipient, i) => i === 0
      ? { ...recipient, included: true, scheduledAtEpochMs: calculation - 2_000 } : recipient),
  }));
  assert.equal(registry.evaluate("WEB-REC-007", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).status, "pass");
});
test("WEB-REC-007 fails recipient inclusion at or after cancellation", () => {
  const c = suppression("WEB-REC-007", {
    registrationStatus: "cancelled", registrationAtEpochMs: calculation - 10_000,
    participantCancellationTriggeredAtEpochMs: calculation - 1_000,
  });
  const observations = c.scheduling!.suppression!.observations.map(o => ({
    ...o, recipientObservations: o.recipientObservations.map((recipient, i) => i === 0
      ? { ...recipient, included: true, scheduledAtEpochMs: calculation - 1_000 } : recipient),
  }));
  assert.equal(registry.evaluate("WEB-REC-007", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).status, "fail");
});
test("suppression evidence with expired validity is rejected", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const observations = c.scheduling!.suppression!.observations.map(o => ({
    ...o, evidence: { ...o.evidence, expiresAtEpochMs: calculation },
  }));
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).reason, "invalid_context");
});
test("suppression evidence with wrong participant scope is rejected", () => {
  const c = suppression("WEB-REC-009", { invalidAddress: true });
  const observations = c.scheduling!.suppression!.observations.map(o => ({
    ...o, evidence: { ...o.evidence, scope: { ...o.evidence.scope, participantIds: ["other"] } },
  }));
  assert.equal(registry.evaluate("WEB-REC-009", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).reason, "invalid_context");
});
test("suppression evidence with an unknown source-reference form is rejected", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const observations = c.scheduling!.suppression!.observations.map(o => ({
    ...o, evidence: { ...o.evidence, sourceReference: "x" },
  }));
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).reason, "invalid_context");
});
test("unavailable suppression evidence cannot turn included-recipient payload into a confirmed failure", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const observations = c.scheduling!.suppression!.observations.map(o => ({
    ...o,
    evidence: { ...o.evidence, evidenceStatus: "unavailable" as const },
    recipientObservations: o.recipientObservations.map((recipient, i) =>
      i === 0 ? { ...recipient, included: true } : recipient),
  }));
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).status, "evidence_unavailable");
});
test("confirmed suppression failure outranks unavailable evidence from another participant", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const firstParticipant = c.scheduling!.suppression!.audiencePlan.participants[0]!;
  const participants = [firstParticipant, { ...firstParticipant, participantId: "p-2" }];
  const firstObservation = c.scheduling!.suppression!.observations[0]!;
  const observations: SuppressionObservation[] = [{
    ...firstObservation,
    evidence: { ...firstObservation.evidence, evidenceStatus: "unavailable" },
  }, {
    ...firstObservation, participantId: "p-2",
    evidence: {
      ...firstObservation.evidence, evidenceId: "evidence-p-2",
      scope: { ...firstObservation.evidence.scope, participantIds: ["p-2"] },
    },
    recipientObservations: firstObservation.recipientObservations.map((recipient, i) =>
      i === 0 ? { ...recipient, included: true } : recipient),
  }];
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: {
        ...c.scheduling!.suppression!,
        audiencePlan: { ...c.scheduling!.suppression!.audiencePlan, participants },
        observations,
      },
    },
  }).status, "fail");
});
test("WEB-REC-007 rejects generic participant-state suppression without actual cancelled state", () => {
  const c = suppression("WEB-REC-007", {
    registrationStatus: "cancelled", registrationAtEpochMs: calculation - 10_000,
    participantCancellationTriggeredAtEpochMs: calculation - 1_000,
  });
  const participants = c.scheduling!.suppression!.audiencePlan.participants.map(participant => ({
    ...participant, state: "registered" as const,
  }));
  assert.equal(registry.evaluate("WEB-REC-007", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: {
        ...c.scheduling!.suppression!,
        audiencePlan: { ...c.scheduling!.suppression!.audiencePlan, participants },
      },
    },
  }).status, "fail");
});
test("WEB-REC-007 rejects a cancellation instant later than observation", () => {
  const c = suppression("WEB-REC-007", {
    registrationStatus: "cancelled", registrationAtEpochMs: calculation - 10_000,
    participantCancellationTriggeredAtEpochMs: calculation - 1_000,
  });
  const observations = c.scheduling!.suppression!.observations.map(observation => ({
    ...observation, cancellationAtEpochMs: calculation + 1,
  }));
  assert.equal(registry.evaluate("WEB-REC-007", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, observations } },
  }).reason, "invalid_context");
});
test("suppression population rejects null observation entries without throwing", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: {
        ...c.scheduling!.suppression!, observations: [null as unknown as SuppressionObservation],
      },
    },
  }).reason, "invalid_context");
});
test("complete suppression population rejects an audience participant without a matching observation", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const first = c.scheduling!.suppression!.audiencePlan.participants[0]!;
  const participants = [...c.scheduling!.suppression!.audiencePlan.participants, {
    ...first, participantId: "p-2",
  }];
  assert.equal(registry.evaluate("WEB-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: {
        ...c.scheduling!.suppression!,
        audiencePlan: { ...c.scheduling!.suppression!.audiencePlan, participants },
      },
    },
  }).reason, "invalid_context");
});

test("WEB-RDY-REC-006: active controls cannot hide unimplemented WEB-REC-010", () => {
  assert.equal(registry.evaluate("WEB-RDY-REC-006", suppression("WEB-REC-006", { optedOut: true })).status, "evidence_unavailable");
});
test("WEB-RDY-REC-006: complete passing canonical prerequisite findings and active controls pass", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const prerequisiteResults = c.scheduling!.suppression!.prerequisiteResults.map(item => ({
    ...item, status: "pass" as const, reason: "satisfied" as const,
    evidence: [`Synthetic current population-scoped result for ${item.ruleId}.`],
  }));
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, prerequisiteResults },
    },
  }).status, "pass");
});
test("WEB-RDY-REC-006: inactive suppression control fails", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const controls = c.scheduling!.suppression!.controls.map((control, i) => i === 0 ? { ...control, active: false } : control);
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, controls } },
  }).status, "fail");
});
test("WEB-RDY-REC-006: canonical failed prerequisite outranks unavailable control evidence", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const controls = c.scheduling!.suppression!.controls.map((control, i) => i === 0
    ? { ...control, evidence: { ...control.evidence, evidenceStatus: "unavailable" as const } } : control);
  const prerequisiteResults = c.scheduling!.suppression!.prerequisiteResults.map((item, i) => i === 1
    ? { ...item, status: "fail" as const, reason: "violation" as const } : item);
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, controls, prerequisiteResults },
    },
  }).status, "fail");
});
test("WEB-RDY-REC-006: missing governed suppression control is evidence unavailable", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: {
        ...c.scheduling!.suppression!, controls: c.scheduling!.suppression!.controls.slice(0, -1),
      },
    },
  }).status, "evidence_unavailable");
});
test("WEB-RDY-REC-006: unknown control source reference is invalid context", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const controls = c.scheduling!.suppression!.controls.map((control, i) => i === 0 ? {
    ...control, evidence: { ...control.evidence, sourceReference: "x" },
  } : control);
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, controls } },
  }).reason, "invalid_context");
});
test("WEB-RDY-REC-006: known inactive control outranks a missing control", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const controls = c.scheduling!.suppression!.controls.slice(0, -1)
    .map((control, i) => i === 0 ? { ...control, active: false } : control);
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, controls } },
  }).status, "fail");
});
test("WEB-RDY-REC-006: known failed finding outranks a missing finding", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const prerequisiteResults = c.scheduling!.suppression!.prerequisiteResults.slice(0, -1)
    .map((item, i) => i === 0 ? {
      ...item, status: "fail" as const, reason: "violation" as const,
    } : item);
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: {
      ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, prerequisiteResults },
    },
  }).status, "fail");
});
test("WEB-RDY-REC-006: duplicate control evidence identity is invalid context", () => {
  const c = suppression("WEB-REC-006", { optedOut: true });
  const duplicateId = c.scheduling!.suppression!.controls[0]!.evidence.evidenceId;
  const controls = c.scheduling!.suppression!.controls.map((control, i) => i === 1 ? {
    ...control, evidence: { ...control.evidence, evidenceId: duplicateId },
  } : control);
  assert.equal(registry.evaluate("WEB-RDY-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: { ...c.scheduling!.suppression!, controls } },
  }).reason, "invalid_context");
});
for (const ruleId of ["WEB-RDY-REC-005", "WEB-RDY-REC-006"] as const) {
  test(`${ruleId}: missing canonical evaluation stage is evidence unavailable`, () => {
    const c = ruleId === "WEB-RDY-REC-006"
      ? suppression("WEB-REC-006", { optedOut: true }) : context(plan(7));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, evaluationStage: null },
    }).status, "evidence_unavailable");
  });
  test(`${ruleId}: unknown evaluation stage is invalid context`, () => {
    const c = ruleId === "WEB-RDY-REC-006"
      ? suppression("WEB-REC-006", { optedOut: true }) : context(plan(7));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, evaluationStage: "Not a canonical stage" },
    }).reason, "invalid_context");
  });
  test(`${ruleId}: another canonical stage is not applicable`, () => {
    const c = ruleId === "WEB-RDY-REC-006"
      ? suppression("WEB-REC-006", { optedOut: true }) : context(plan(7));
    assert.equal(registry.evaluate(ruleId, {
      ...c, scheduling: { ...c.scheduling!, evaluationStage: "Ready to run" },
    }).status, "not_applicable");
  });
  test(`${ruleId}: Ready to recruit evaluates the governed evidence`, () => {
    const c = ruleId === "WEB-RDY-REC-006"
      ? suppression("WEB-REC-006", { optedOut: true }) : context(plan(7));
    const result = registry.evaluate(ruleId, c);
    assert.equal(result.status, ruleId === "WEB-RDY-REC-006" ? "evidence_unavailable" : "pass");
  });
}
test("WEB-WIN-007: complete actual rendered omission evidence passes", () => {
  assert.equal(registry.evaluate("WEB-WIN-007", context(plan(7))).status, "pass");
});
test("WEB-WIN-007: missing rendered evidence is evidence unavailable", () => {
  const c = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: { ...c.scheduling!, omissionDisplay: null },
  }).status, "evidence_unavailable");
});
test("WEB-WIN-007: incomplete rendered omission list fails", () => {
  const c = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: {
      ...c.scheduling!, omissionDisplay: {
        ...c.scheduling!.omissionDisplay!, entries: c.scheduling!.omissionDisplay!.entries.slice(1),
      },
    },
  }).status, "fail");
});
test("WEB-WIN-007: expired rendered evidence is invalid context", () => {
  const c = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: {
      ...c.scheduling!, omissionDisplay: {
        ...c.scheduling!.omissionDisplay!,
        evidence: { ...c.scheduling!.omissionDisplay!.evidence, expiresAtEpochMs: c.observedAtEpochMs },
      },
    },
  }).reason, "invalid_context");
});
test("WEB-WIN-007: evidence bound to an old render version is invalid context", () => {
  const c = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: {
      ...c.scheduling!, omissionDisplay: {
        ...c.scheduling!.omissionDisplay!, renderVersion: "render-v2",
      },
    },
  }).reason, "invalid_context");
});
test("WEB-WIN-007: wrong-version rendered evidence is invalid context", () => {
  const c = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: {
      ...c.scheduling!, omissionDisplay: {
        ...c.scheduling!.omissionDisplay!,
        evidence: {
          ...c.scheduling!.omissionDisplay!.evidence,
          standardVersion: "wrong" as typeof catalog.standardVersion,
        },
      },
    },
  }).reason, "invalid_context");
});
test("WEB-WIN-007: malformed rendered-evidence source reference is invalid context", () => {
  const c = context(plan(7));
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: {
      ...c.scheduling!, omissionDisplay: {
        ...c.scheduling!.omissionDisplay!,
        evidence: { ...c.scheduling!.omissionDisplay!.evidence, sourceReference: "x" },
      },
    },
  }).reason, "invalid_context");
});
test("WEB-WIN-007: duplicate rendered omission identity is invalid context", () => {
  const c = context(plan(7));
  const first = c.scheduling!.omissionDisplay!.entries[0]!;
  assert.equal(registry.evaluate("WEB-WIN-007", {
    ...c, scheduling: {
      ...c.scheduling!, omissionDisplay: {
        ...c.scheduling!.omissionDisplay!, entries: [first, { ...first }],
      },
    },
  }).reason, "invalid_context");
});
test("WEB-WIN-007: full window without omissions is not applicable", () => {
  assert.equal(registry.evaluate("WEB-WIN-007", context(plan(21))).status, "not_applicable");
});
test("Scheduling batch exports exactly the approved 15 IDs within the current registry", () => {
  assert.equal(SCHEDULING_BATCH_RULE_IDS.length, 15);
  assert.equal(new Set(SCHEDULING_BATCH_RULE_IDS).size, 15);
  assert.equal(
    registry.implementedRuleIds.length + registry.unimplementedRuleIds.length,
    catalog.rules.length,
  );
  assert.ok(SCHEDULING_BATCH_RULE_IDS.every(id => registry.implementedRuleIds.includes(id)));
});
test("Scheduling batch has no overlap with the accepted prior 38 evaluators", () => {
  assert.deepEqual(SCHEDULING_BATCH_RULE_IDS.filter(id =>
    (IMPLEMENTED_RULE_IDS as readonly string[]).includes(id)), []);
});
test("Scheduling batch contains no unknown canonical rule identifier", () => {
  const canonicalIds = new Set(catalog.rules.map(rule => rule.ruleId));
  assert.ok(SCHEDULING_BATCH_RULE_IDS.every(id => canonicalIds.has(id)));
});
test("Scheduling registry remains duplicate-free within the current canonical partition", () => {
  assert.equal(new Set(registry.implementedRuleIds).size, registry.implementedRuleIds.length);
  assert.equal(new Set(registry.unimplementedRuleIds).size, registry.unimplementedRuleIds.length);
  assert.equal(registry.implementedRuleIds.filter(id => registry.unimplementedRuleIds.includes(id)).length, 0);
  assert.equal(registry.implementedRuleIds.length + registry.unimplementedRuleIds.length, catalog.rules.length);
});
test("Scheduling batch has no exception-eligible failed blocker", () => {
  const eligible = SCHEDULING_BATCH_RULE_IDS.map(id => catalog.rules.find(rule => rule.ruleId === id)!)
    .filter(rule => rule.exceptionEligible
      && ["Mandatory blocker", "Conditional blocker"].includes(rule.primaryRuleType));
  assert.deepEqual(eligible, []);
});
test("Recommended-default scheduling failure cannot be exception-resolved as a blocker", () => {
  const c = context(plan(21));
  const touches = c.scheduling!.configuredPlan!.touches.map((touch, i) => i === 0
    ? { ...touch, scheduledAtEpochMs: touch.scheduledAtEpochMs! + 1 } : touch);
  const result = registry.evaluate("WEB-REC-001", {
    ...c, scheduling: {
      ...c.scheduling!, creationSnapshot: {
        ...c.scheduling!.creationSnapshot!,
        configuredPlan: { ...c.scheduling!.creationSnapshot!.configuredPlan, touches },
      },
    },
  });
  assert.equal(result.status, "fail");
  assert.equal(result.rule.exceptionEligible, true);
  assert.equal(isBlockingFailure(result), false);
});
test("Missing operational evidence cannot become an exception-resolvable failure", () => {
  const c = context();
  const result = registry.evaluate("WEB-REC-006", {
    ...c, scheduling: { ...c.scheduling!, suppression: null },
  });
  assert.equal(result.status, "evidence_unavailable");
  assert.equal(isBlockingFailure(result), false);
});