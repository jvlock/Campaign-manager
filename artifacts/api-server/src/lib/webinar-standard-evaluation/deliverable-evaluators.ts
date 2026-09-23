import type { WebinarStandardCatalog } from "../webinar-standard-catalog/types";
import type { DeliverableRole, DeliverableRuleId } from "./deliverable-types";
import type { EvaluationContext, RuleEvaluator, RuleFinding } from "./types";
import { artifact, combine, common, condition, evidence, fail, invalid, missing, na, prerequisite, stage } from "./deliverable-helpers";

export const DELIVERABLE_BATCH_RULE_IDS = Object.freeze([
  "WEB-SETUP-012", "WEB-SETUP-019", "WEB-SETUP-C02", "WEB-SETUP-C03", "WEB-SETUP-C04", "WEB-SETUP-C06", "WEB-SETUP-C08",
  "WEB-FU-ATT-002", "WEB-FU-ATT-003", "WEB-FU-ATT-004", "WEB-FU-ATT-005",
  "WEB-FU-ABS-002", "WEB-FU-ABS-003", "WEB-FU-ABS-004", "WEB-FU-ABS-005",
  "WEB-FU-WL-004", "WEB-FU-INT-002", "WEB-RDY-REC-003", "WEB-RDY-RUN-002",
  "WEB-RDY-RUN-003", "WEB-RDY-RUN-004", "WEB-RDY-RUN-006",
  "WEB-QA-001", "WEB-QA-002", "WEB-QA-007", "WEB-QA-009",
] as const satisfies readonly DeliverableRuleId[]);

/** Explicit rule implementations; shared routines only select artifacts or validate evidence. */
export function createDeliverableEvaluators(catalog: WebinarStandardCatalog): Readonly<Record<DeliverableRuleId, RuleEvaluator>> {
  const bind = (evaluate: RuleEvaluator): RuleEvaluator => c => common(catalog, c) ?? evaluate(c);
  const one = (c: EvaluationContext, id: DeliverableRuleId, role: DeliverableRole) =>
    artifact(catalog, c, id, c.deliverables!.artifacts.find(a => a.role === role));
  const every = (c: EvaluationContext, id: DeliverableRuleId, role: DeliverableRole) => {
    const d = c.deliverables!;
    if (!d.complete) return missing("The required supporting inventory must be complete.");
    if (!d.supportingContentInventoryEvidence) return missing("The complete applicable supporting-content inventory requires human confirmation.");
    const inventory = evidence(catalog, c, id, d.supportingContentInventoryEvidence, null);
    const items = d.artifacts.filter(a => a.role === role);
    return combine([inventory, ...items.map(a => artifact(catalog, c, id, a))]);
  };
  function participant(c: EvaluationContext, attendance: "attended" | "absent"): RuleFinding | null {
    if (!c.participant) return missing("Selected participant state is required.");
    return c.participant.attendanceState === attendance && c.participant.audienceClass === "customer" ? null : na();
  }
  function message(c: EvaluationContext, id: DeliverableRuleId, variant: "attended" | "absent" | "test", recording = false): RuleFinding {
    const d = c.deliverables!;
    const messages = d.communications.filter(x => x.variant === variant && x.kind === (variant === "test" ? "qa_test" : "follow_up"));
    if (!messages.length) return d.complete ? fail("Required distinct communication variant is absent.") : missing("Communication inventory is incomplete.");
    return combine(messages.map(x => {
      const a = d.artifacts.find(a => a.role === "message" && a.communicationId === x.communicationId);
      if (a && recording && !a.assetId && !a.destinationId) return fail("Available recording is not attached to this message.");
      return artifact(catalog, c, id, a);
    }));
  }
  function speaker(c: EvaluationContext, id: "WEB-SETUP-012" | "WEB-QA-001", receipt = false): RuleFinding {
    const speakers = c.deliverables!.artifacts.filter(a => a.role === "speaker" && a.speakerConfirmed === true);
    if (!speakers.length) return c.deliverables!.complete ? fail("No confirmed speaker record exists.") : missing("Speaker inventory is incomplete.");
    const checks = speakers.map(a => artifact(catalog, c, id, a, receipt ? "receipt" : "review"));
    // Existential rule: one positively confirmed speaker suffices, but malformed supplied evidence never does.
    return checks.find(r => r.reason === "invalid_context") ?? checks.find(r => r.status === "pass") ?? combine(checks);
  }
  function recordingAvailable(c: EvaluationContext): RuleFinding | null {
    const availability = c.deliverables!.facts.recordingAvailability;
    if (availability === null) return missing("Current recording availability is unknown.");
    if (availability !== "available") return na();
    const result = prerequisite(catalog, c, "WEB-SETUP-019");
    return result.status === "pass" ? null : result;
  }

  const evaluate_WEB_SETUP_012 = bind(c => speaker(c, "WEB-SETUP-012"));
  const evaluate_WEB_SETUP_019 = bind(c => c.deliverables!.facts.recordingAvailability === null
    ? missing("Recording availability must be stated, including not expected.")
    : one(c, "WEB-SETUP-019", "recording_statement"));
  const evaluate_WEB_SETUP_C02 = bind(c => {
    const { capacitySet, capacityReachable } = c.deliverables!.facts;
    if (capacitySet === false || capacityReachable === false) return na();
    if (capacitySet === null || capacityReachable === null) return missing("Capacity applicability is unknown.");
    return one(c, "WEB-SETUP-C02", "waitlist_procedure");
  });
  const evaluate_WEB_SETUP_C03 = bind(c => condition(c.deliverables!.facts.objectiveCallsForHandraiser) ?? one(c, "WEB-SETUP-C03", "handraiser"));
  const evaluate_WEB_SETUP_C04 = bind(c => condition(c.deliverables!.facts.supportingChannelsUsed) ?? one(c, "WEB-SETUP-C04", "support_channel"));
  const evaluate_WEB_SETUP_C06 = bind(c => condition(c.deliverables!.facts.accessibilityRequired) ?? one(c, "WEB-SETUP-C06", "accessibility"));
  const evaluate_WEB_SETUP_C08 = bind(c => condition(c.deliverables!.facts.salesAdjacent) ?? one(c, "WEB-SETUP-C08", "sales_handoff"));
  const evaluate_WEB_FU_ATT_002 = bind(c => participant(c, "attended") ?? message(c, "WEB-FU-ATT-002", "attended"));
  const evaluate_WEB_FU_ATT_003 = bind(c => participant(c, "attended") ?? recordingAvailable(c) ?? message(c, "WEB-FU-ATT-003", "attended", true));
  const evaluate_WEB_FU_ATT_004 = bind(c => participant(c, "attended") ?? message(c, "WEB-FU-ATT-004", "attended"));
  const evaluate_WEB_FU_ATT_005 = bind(c => participant(c, "attended") ?? condition(c.deliverables!.facts.objectiveCallsForHandraiser) ?? message(c, "WEB-FU-ATT-005", "attended"));
  const evaluate_WEB_FU_ABS_002 = bind(c => participant(c, "absent") ?? message(c, "WEB-FU-ABS-002", "absent"));
  const evaluate_WEB_FU_ABS_003 = bind(c => participant(c, "absent") ?? recordingAvailable(c) ?? message(c, "WEB-FU-ABS-003", "absent", true));
  const evaluate_WEB_FU_ABS_004 = bind(c => participant(c, "absent") ?? message(c, "WEB-FU-ABS-004", "absent"));
  const evaluate_WEB_FU_ABS_005 = bind(c => participant(c, "absent") ?? condition(c.deliverables!.facts.absentHandraiserAppropriate) ?? message(c, "WEB-FU-ABS-005", "absent"));
  const evaluate_WEB_FU_WL_004 = bind(c => condition(c.deliverables!.facts.waitlistInUse) ?? one(c, "WEB-FU-WL-004", "plan"));
  const evaluate_WEB_FU_INT_002 = bind(c => {
    const trigger = condition(c.deliverables!.facts.qaSendRequested);
    if (trigger) return trigger;
    if (!c.participant) return missing("QA recipient scope is required.");
    if (c.participant.audienceClass === "customer") return na();
    return message(c, "WEB-FU-INT-002", "test");
  });
  const evaluate_WEB_RDY_REC_003 = bind(c => {
    const gate = stage(c.deliverables!, "Ready to recruit");
    if (gate) return gate;
    const page = c.deliverables!.artifacts.find(a => a.role === "registration_page");
    if (page && !page.destinationId) return fail("Registration page destination identity is absent.");
    if (!c.setup?.registrationDestination) return missing("Current setup registration destination is required for page correspondence.");
    if (c.setup.eventId !== c.event.eventId || c.setup.snapshotId !== c.deliverables!.snapshotVersion
      || (page && page.destinationId !== c.setup.registrationDestination)) return invalid("Tested page does not match the current setup destination.");
    return combine([prerequisite(catalog, c, "WEB-SETUP-011"),
      artifact(catalog, c, "WEB-RDY-REC-003", page, "test"), artifact(catalog, c, "WEB-RDY-REC-003", page, "approval")]);
  });
  const evaluate_WEB_RDY_RUN_002 = bind(c => stage(c.deliverables!, "Ready to run")
    ?? prerequisite(catalog, c, "WEB-SETUP-012"));
  const evaluate_WEB_RDY_RUN_003 = bind(c => stage(c.deliverables!, "Ready to run") ?? one(c, "WEB-RDY-RUN-003", "brief"));
  const evaluate_WEB_RDY_RUN_004 = bind(c => stage(c.deliverables!, "Ready to run") ?? every(c, "WEB-RDY-RUN-004", "supporting_content"));
  const evaluate_WEB_RDY_RUN_006 = bind(c => {
    const gate = stage(c.deliverables!, "Ready to run");
    if (gate) return gate;
    const used = c.deliverables!.facts.captureInUse;
    if (used === null) return missing("Capture applicability is unknown; absence must be documented.");
    return artifact(catalog, c, "WEB-RDY-RUN-006", c.deliverables!.artifacts.find(a => a.role === "capture"), used ? "test" : "review");
  });
  const evaluate_WEB_QA_001 = bind(c => stage(c.deliverables!, "Ready to run") ?? speaker(c, "WEB-QA-001", true));
  const evaluate_WEB_QA_002 = bind(c => stage(c.deliverables!, "Ready to run") ?? one(c, "WEB-QA-002", "brief"));
  const evaluate_WEB_QA_007 = bind(c => stage(c.deliverables!, "Ready to recruit")
    ?? condition(c.deliverables!.facts.waitlistInUse) ?? one(c, "WEB-QA-007", "plan"));
  const evaluate_WEB_QA_009 = bind(c => {
    const d = c.deliverables!, gate = stage(d, "Ready to run");
    if (gate) return gate;
    if (!d.complete) return missing("Complete current QA inventory is required.");
    const start = c.event.startsAtEpochMs;
    if (start === null) return missing("Event start is required to confirm pre-event QA.");
    const checklist = d.artifacts.find(a => a.role === "qa_checklist");
    const final = artifact(catalog, c, "WEB-QA-009", checklist);
    if (final.status !== "pass") return final;
    if (checklist!.reviews.filter(r => r.evidence.ruleId === "WEB-QA-009")
      .some(r => r.evidence.binding.reviewedAtEpochMs >= start || r.evidence.suppliedAtEpochMs >= start)) return fail("Final QA was not confirmed before the event.");
    const finalReview = Math.max(...checklist!.reviews.filter(r => r.ruleId === "WEB-QA-009" && r.kind === "review").map(r => r.evidence.binding.reviewedAtEpochMs));
    const componentIds = ["WEB-QA-001", "WEB-QA-002", "WEB-QA-003", "WEB-QA-004", "WEB-QA-005", "WEB-QA-006", "WEB-QA-007", "WEB-QA-008"];
    if (d.prerequisites.some(p => componentIds.includes(p.result.ruleId)
      && p.evidence.binding.reviewedAtEpochMs > finalReview)) return missing("Final checklist does not yet confirm the latest component QA observations.");
    // All canonical component QA checks, including recruit-stage checks, remain current.
    // QA-005/006 carry governed requirements; no unrelated governed-service trigger is invented.
    return combine([
      prerequisite(catalog, c, "WEB-QA-001", false, start),
      prerequisite(catalog, c, "WEB-QA-002", false, start),
      prerequisite(catalog, c, "WEB-QA-003", false, start),
      prerequisite(catalog, c, "WEB-QA-004", false, start),
      prerequisite(catalog, c, "WEB-QA-005", false, start),
      prerequisite(catalog, c, "WEB-QA-006", false, start),
      prerequisite(catalog, c, "WEB-QA-007", d.facts.waitlistInUse === false, start),
      prerequisite(catalog, c, "WEB-QA-008", false, start),
    ]);
  });
  return Object.freeze({
    "WEB-SETUP-012": evaluate_WEB_SETUP_012, "WEB-SETUP-019": evaluate_WEB_SETUP_019,
    "WEB-SETUP-C02": evaluate_WEB_SETUP_C02, "WEB-SETUP-C03": evaluate_WEB_SETUP_C03,
    "WEB-SETUP-C04": evaluate_WEB_SETUP_C04, "WEB-SETUP-C06": evaluate_WEB_SETUP_C06, "WEB-SETUP-C08": evaluate_WEB_SETUP_C08,
    "WEB-FU-ATT-002": evaluate_WEB_FU_ATT_002, "WEB-FU-ATT-003": evaluate_WEB_FU_ATT_003,
    "WEB-FU-ATT-004": evaluate_WEB_FU_ATT_004, "WEB-FU-ATT-005": evaluate_WEB_FU_ATT_005,
    "WEB-FU-ABS-002": evaluate_WEB_FU_ABS_002, "WEB-FU-ABS-003": evaluate_WEB_FU_ABS_003,
    "WEB-FU-ABS-004": evaluate_WEB_FU_ABS_004, "WEB-FU-ABS-005": evaluate_WEB_FU_ABS_005,
    "WEB-FU-WL-004": evaluate_WEB_FU_WL_004, "WEB-FU-INT-002": evaluate_WEB_FU_INT_002,
    "WEB-RDY-REC-003": evaluate_WEB_RDY_REC_003, "WEB-RDY-RUN-002": evaluate_WEB_RDY_RUN_002,
    "WEB-RDY-RUN-003": evaluate_WEB_RDY_RUN_003, "WEB-RDY-RUN-004": evaluate_WEB_RDY_RUN_004,
    "WEB-RDY-RUN-006": evaluate_WEB_RDY_RUN_006, "WEB-QA-001": evaluate_WEB_QA_001,
    "WEB-QA-002": evaluate_WEB_QA_002, "WEB-QA-007": evaluate_WEB_QA_007, "WEB-QA-009": evaluate_WEB_QA_009,
  });
}