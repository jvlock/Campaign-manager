import { z } from "zod";
import { RULE_IDS, READINESS_STAGES, PRIMARY_RULE_TYPES, HIERARCHY_LEVELS, EVIDENCE_BASES, VALIDATION_METHODS, STANDARD_ID, STANDARD_VERSION } from "./webinar-standard-catalog/types";

const text = z.string().max(20000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const engineRelease = z.object({
  digest: hash,
  provenance: z.object({
    schemaVersion: z.literal(1), mode: z.literal("open-development"), operational: z.literal(false),
    standardId: z.literal(STANDARD_ID), standardVersion: z.literal(STANDARD_VERSION),
    canonicalDocuments: z.record(z.string(), hash),
    evaluatorRegistry: z.object({
      digest: hash, implementationHashes: z.record(z.string(), hash),
      coverage: z.object({
        implemented: z.literal(106), total: z.literal(106), implementedRuleIds: z.array(z.enum(RULE_IDS)),
        unimplementedRuleIds: z.array(z.string()).length(0),
      }).strict(),
    }).strict(),
    applicationRelease: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
    dependencies: z.record(z.string(), z.string()),
  }).strict(),
}).strict();
const ruleId = z.enum(RULE_IDS);
const stage = z.enum(READINESS_STAGES);
const rule = z.object({
  ruleId, ruleName: text, hierarchyLevel: z.enum(HIERARCHY_LEVELS), trigger: text,
  expectedBehavior: text, primaryRuleType: z.enum(PRIMARY_RULE_TYPES),
  evidenceBasis: z.enum(EVIDENCE_BASES), readinessStage: stage,
  validationMethod: z.enum(VALIDATION_METHODS), exceptionEligible: z.boolean(),
  exceptionEligibleNote: text.nullable(), failureMessage: text, resolutionGuidance: text,
}).strict();
export const simulationFindingSchema = z.object({
  mode: z.literal("descriptive_only"), standardId: z.literal(STANDARD_ID),
  standardVersion: z.literal(STANDARD_VERSION), ruleId, rule,
  status: z.enum(["pass", "fail", "not_applicable", "evidence_unavailable", "unimplemented"]),
  reason: z.enum(["satisfied", "violation", "condition_not_met", "missing_evidence", "invalid_context", "not_implemented"]),
  participantId: z.string().nullable(), evidence: z.array(text),
}).strict();
const findings = z.array(simulationFindingSchema).max(106);
const exception = z.object({
  exceptionId: text, standardId: z.literal(STANDARD_ID), standardVersion: z.literal(STANDARD_VERSION),
  ruleId, requirementOverridden: text, businessJustification: text, requestor: text, reviewer: text,
  reviewerVerificationStatus: z.enum(["unverified", "not_recorded"]),
  decision: z.enum(["approved", "pending", "rejected", "returned", "expired", "revoked"]),
  decisionAtEpochMs: z.number(), expiresAtEpochMs: z.number().nullable(), expirationRequired: z.boolean(),
  compensatingAction: text.nullable(), compensatingActionRequired: z.boolean(), createdAtEpochMs: z.number(),
  pilotAudit: z.object({ pilotReference: text, auditReference: text }).strict(),
}).strict();
const resolved = z.object({ ruleId, classification: z.literal("resolvedByException"), originalFailure: simulationFindingSchema, exception }).strict();
const issue = z.object({ code: text, ruleId: z.string().nullable(), stage: stage.nullable(), message: text }).strict();
const sourceReference = z.object({ sourceType: text, sourceId: text, sourceHash: hash.optional(), sourceVersion: text.optional() }).strict();
const gap = z.object({ field: text, reason: text, sourceReference: sourceReference.nullable() }).strict();
const readinessStage = z.object({
  stage, status: z.enum(["ready", "blocked", "incomplete"]), fullyEvaluated: z.boolean(),
  assignedRuleIds: z.array(ruleId), applicableRuleIds: z.array(ruleId), evaluatedRuleIds: z.array(ruleId),
  missingRuleIds: z.array(ruleId), passes: findings, notApplicable: findings, failedBlockers: findings,
  unassessedBlockers: findings, unassessedAdvisories: findings, failedNonBlocking: findings,
  warnings: findings, exceptionResolvedBlockers: z.array(resolved), unresolvedRuleIds: z.array(ruleId),
  diagnosticCoveragePercent: z.number(), issues: z.array(issue),
  prerequisiteIssues: z.array(z.object({
    prerequisite: z.enum(["Ready to run", "attendanceReconciliation", "requiredFollowUpCompletion", "exceptionRecording", "measurementCapture"]),
    status: z.enum(["blocked", "incomplete"]), message: text,
  }).strict()),
}).strict();
/** Strict data-only persisted projection. Request diagnostics are deliberately not a field. */
export const simulationSnapshotSchema = z.object({
  activityId: z.string().uuid(), occurrenceId: z.string().uuid(),
  standard: z.object({ id: z.literal(STANDARD_ID), version: z.literal(STANDARD_VERSION) }).strict(),
  calculationAt: z.string().datetime(), releaseFingerprint: hash, inputFingerprint: hash,
  /** Absent only on historical snapshots written before the distinct engine identity existed. */
  engineReleaseFingerprint: hash.optional(), engineRelease: engineRelease.optional(),
  sourceReferences: z.array(sourceReference),
  applicableRules: z.array(ruleId), passedRules: z.array(ruleId),
  results: findings, unresolvedBlockingFailures: findings,
  blockersResolvedByExceptions: z.array(resolved), nonblockingFailures: findings, warnings: findings,
  missingInputData: z.array(gap), unavailableExternalObservations: z.array(gap),
  mappingErrors: z.array(z.object({ code: text, field: text, message: text, sourceReference: sourceReference.nullable() }).strict()),
  evaluatorCoverage: z.object({
    totalRuleCount: z.number().int(), implementedRuleCount: z.number().int(), missingEvaluatorCount: z.number().int(),
    implementedRuleIds: z.array(ruleId), missingEvaluatorRuleIds: z.array(ruleId),
  }).strict(),
  readinessStages: z.array(readinessStage), readinessIssues: z.array(issue),
  completionResult: z.object({
    outcome: z.enum(["complete", "incomplete_blocker", "incomplete_evidence", "incomplete_operational", "incomplete_invalid_context", "incomplete_evaluator_unavailable", "resolvedByException", "advisory"]),
    complete: z.boolean(), blockers: findings, evidenceUnavailable: findings, operationalGaps: z.array(text),
    resolvedByException: z.array(ruleId), advisories: findings, issues: z.array(text),
  }).strict(),
  operationalStatus: z.literal("simulation-only"),
}).strict();
export type SimulationSnapshot = z.infer<typeof simulationSnapshotSchema>;