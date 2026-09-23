import type { RuleId } from "../../src/lib/webinar-standard-catalog/types";
import type { ManualEvidence } from "../../src/lib/webinar-standard-evidence";
import type { DeliverableArtifact, DeliverableEvaluationContext, DeliverablePrerequisite, DeliverableRole, DeliverableRuleId } from "../../src/lib/webinar-standard-evaluation/deliverable-types";
import type { EvaluationContext } from "../../src/lib/webinar-standard-evaluation/types";
import { finding } from "../readiness/fixtures";
import { catalog, makeContext, referenceTime } from "./fixtures";

export type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export const now = referenceTime;
export const roles: Readonly<Record<DeliverableRuleId, DeliverableRole | null>> = {
  "WEB-SETUP-012": "speaker", "WEB-SETUP-019": "recording_statement", "WEB-SETUP-C02": "waitlist_procedure",
  "WEB-SETUP-C03": "handraiser", "WEB-SETUP-C04": "support_channel", "WEB-SETUP-C06": "accessibility", "WEB-SETUP-C08": "sales_handoff",
  "WEB-FU-ATT-002": "message", "WEB-FU-ATT-003": "message", "WEB-FU-ATT-004": "message", "WEB-FU-ATT-005": "message",
  "WEB-FU-ABS-002": "message", "WEB-FU-ABS-003": "message", "WEB-FU-ABS-004": "message", "WEB-FU-ABS-005": "message",
  "WEB-FU-WL-004": "plan", "WEB-FU-INT-002": "message", "WEB-RDY-REC-003": "registration_page",
  "WEB-RDY-RUN-002": null, "WEB-RDY-RUN-003": "brief", "WEB-RDY-RUN-004": "supporting_content",
  "WEB-RDY-RUN-006": "capture", "WEB-QA-001": "speaker", "WEB-QA-002": "brief", "WEB-QA-007": "plan", "WEB-QA-009": "qa_checklist",
};
export function manual(id: RuleId, a: DeliverableArtifact | null = null, suffix = ""): ManualEvidence {
  return {
    evidenceId: `e-${id}-${a?.deliverableId ?? "snapshot"}${suffix}`, ruleId: id,
    standardId: catalog.standardId, standardVersion: catalog.standardVersion,
    evidenceStatus: "confirmed", evidenceDescription: `Reviewer examined the canonical requirement for ${id} on the referenced version.`,
    suppliedBy: { nameOrPilotIdentifier: "pilot-reviewer", identityVerified: false },
    suppliedAtEpochMs: now - 100, validFromEpochMs: now - 100, expiresAtEpochMs: null,
    sourceReference: "ref:event:event-1:source-review", attachmentReference: null,
    notes: "Test fixture: supplied observation, not authenticated identity or execution authority.",
    scope: { eventId: "event-1", sessionIds: ["occurrence-1"], participantIds: [],
      communicationIds: a?.communicationId ? [a.communicationId] : [], deliverableIds: a ? [a.deliverableId] : [] },
    binding: { inputSnapshotVersion: "snapshot-1", artifactVersion: a?.contentVersion ?? null,
      reviewedAtEpochMs: now - 100, snapshotCompleteness: "complete", observationFromEpochMs: null, observationThroughEpochMs: null },
  };
}
export function pre(id: RuleId): DeliverablePrerequisite {
  return { result: finding(catalog.rules.find(r => r.ruleId === id)!), evidence: manual(id) };
}
export function fixture(id: DeliverableRuleId): Mutable<EvaluationContext> {
  const role = roles[id];
  const absent = ["WEB-FU-ABS-002", "WEB-FU-ABS-003", "WEB-FU-ABS-004", "WEB-FU-ABS-005"].includes(id);
  const variant = id === "WEB-FU-INT-002" ? "test" : absent ? "absent" : "attended";
  const a: DeliverableArtifact = {
    deliverableId: "deliverable-1", role: role ?? "speaker", eventId: "event-1", occurrenceId: "occurrence-1",
    contentVersion: "content-1", versionCreatedAtEpochMs: now - 1000, lifecycle: "produced",
    communicationId: role === "message" ? "communication-1" : null,
    assetId: "shared-recording", destinationId: "https://example.org/registration",
    content: "Concrete reviewable artifact content, not a keyword-based proof.",
    owner: null, dueAtEpochMs: null, speakerConfirmed: true, reviews: [],
  };
  const kinds = id === "WEB-RDY-REC-003" ? ["test", "approval"] as const
    : id === "WEB-QA-001" ? ["receipt"] as const : id === "WEB-RDY-RUN-006" ? ["test"] as const : ["review"] as const;
  const reviewed = { ...a, reviews: kinds.map(kind => ({ ruleId: id, kind, evidence: manual(id, a, kind) })) };
  const prerequisites: DeliverablePrerequisite[] =
    id === "WEB-RDY-RUN-002" ? [pre("WEB-SETUP-012")] : id === "WEB-RDY-REC-003" ? [pre("WEB-SETUP-011")]
    : id === "WEB-FU-ATT-003" || id === "WEB-FU-ABS-003" ? [pre("WEB-SETUP-019")]
    : id === "WEB-QA-009" ? (["WEB-QA-001", "WEB-QA-002", "WEB-QA-003", "WEB-QA-004", "WEB-QA-005", "WEB-QA-006", "WEB-QA-007", "WEB-QA-008"] as const).map(pre) : [];
  const d: DeliverableEvaluationContext = {
    standardId: catalog.standardId, standardVersion: catalog.standardVersion, eventId: "event-1", occurrenceId: "occurrence-1",
    snapshotVersion: "snapshot-1", snapshotCreatedAtEpochMs: now - 500, complete: true, activityType: "Webinar",
    evaluationStage: id === "WEB-RDY-REC-003" || id === "WEB-QA-007" ? "Ready to recruit" : "Ready to run",
    communications: role === "message" ? [{ communicationId: "communication-1", eventId: "event-1", occurrenceId: "occurrence-1",
      kind: variant === "test" ? "qa_test" : "follow_up", channel: "email", variant,
      audienceState: variant === "test" ? "internal_test" : variant }] : [],
    artifacts: role ? [reviewed] : [], prerequisites,
    supportingContentInventoryEvidence: id === "WEB-RDY-RUN-004" ? manual(id) : null,
    facts: { capacitySet: true, capacityReachable: true, objectiveCallsForHandraiser: true, absentHandraiserAppropriate: true,
      supportingChannelsUsed: true, accessibilityRequired: true, salesAdjacent: true, waitlistInUse: true,
      qaSendRequested: true, recordingAvailability: "available", captureInUse: true },
  };
  return structuredClone({ ...makeContext(),
    participant: { ...makeContext().participant!, attendanceState: absent ? "absent" : "attended", audienceClass: variant === "test" ? "test" : "customer" },
    setup: { eventId: "event-1", snapshotId: "snapshot-1", complete: true, activityType: "Webinar", registrationDestination: a.destinationId },
    deliverables: d }) as Mutable<EvaluationContext>;
}
export function proof(c: Mutable<EvaluationContext>, id: DeliverableRuleId): Mutable<ManualEvidence> {
  return id === "WEB-RDY-RUN-002" ? c.deliverables!.prerequisites[0]!.evidence : c.deliverables!.artifacts[0]!.reviews[0]!.evidence;
}