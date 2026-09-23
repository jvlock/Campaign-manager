import { validateWebinarStandardCatalog } from "../webinar-standard-catalog/validate";
import type {
  EvidenceCollectionValidationResult, EvidenceScope, EvidenceValidationContext,
  EvidenceValidationIssue, EvidenceValidationResult, ManualEvidence,
} from "./types";

const scopeKeys = ["sessionIds", "participantIds", "communicationIds", "deliverableIds"] as const;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 8_640_000_000_000_000;
const record = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return (proto === Object.prototype || proto === null)
    && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => "value" in d);
};
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
function scope(v: unknown): v is EvidenceScope {
  return record(v) && text(v.eventId) && scopeKeys.every(k => ids(v[k]));
}
function sameScope(a: EvidenceScope, b: EvidenceScope): boolean {
  return a.eventId === b.eventId && scopeKeys.every(k => a[k].length === b[k].length && a[k].every(id => b[k].includes(id)));
}
function reference(v: unknown, s: EvidenceScope): boolean {
  if (typeof v !== "string" || /[\s\\\u0000-\u001f\u007f]/u.test(v)) return false;
  if (/^https?:\/\//.test(v)) {
    try {
      const url = new URL(v);
      return !!url.hostname && !url.username && !url.password;
    } catch { return false; }
  }
  const match = /^ref:(event|session|participant|communication|deliverable):([A-Za-z0-9._~-]+):([A-Za-z0-9._~-]+)$/.exec(v);
  if (!match) return false;
  const keys = { session: "sessionIds", participant: "participantIds", communication: "communicationIds", deliverable: "deliverableIds" } as const;
  return match[1] === "event" ? match[2] === s.eventId
    : s[keys[match[1] as keyof typeof keys]].includes(match[2]);
}
function frozen<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    for (const child of Object.values(v)) frozen(child);
    Object.freeze(v);
  }
  return v;
}

/** Atomic collection validation: even identical ID reuse rejects the entire collection.
 * No clock, authentication, I/O, policy decision, or automatic pass is performed.
 */
export function validateManualEvidenceCollection(input: unknown, context: EvidenceValidationContext): EvidenceCollectionValidationResult {
  const issues: EvidenceValidationIssue[] = [];
  const add = (code: string, field: string, index: number | null = null) =>
    issues.push({ code, field, index, message: `Evidence validation rejected ${field}: ${code}.` });
  try {
    if (!record(context) || !validateWebinarStandardCatalog(context.catalog).ok
      || !time(context.nowEpochMs) || !scope(context.expectedScope)
      || !text(context.expectedInputSnapshotVersion)
      || !(context.expectedArtifactVersion === null || text(context.expectedArtifactVersion))
      || typeof context.referenceRequired !== "boolean"
      || !context.catalog.rules.some(r => r.ruleId === context.expectedRuleId)) {
      add("invalid_context", "context");
      return frozen({ ok: false, issues });
    }
    if (!Array.isArray(input)) {
      add("invalid_collection", "evidence");
      return frozen({ ok: false, issues });
    }
    const seen = new Set<string>();
    const copied: ManualEvidence[] = [];
    input.forEach((value, index) => {
      const issue = (code: string, field: string) => add(code, field, index);
      const initial = issues.length;
      if (!record(value)) { issue("invalid_evidence", "evidence"); return; }
      if (!text(value.evidenceId)) issue("missing_evidence_id", "evidenceId");
      else if (seen.has(value.evidenceId)) issue("duplicate_evidence_id", "evidenceId");
      else seen.add(value.evidenceId);
      if (!context.catalog.rules.some(r => r.ruleId === value.ruleId)) issue("unknown_rule", "ruleId");
      else if (value.ruleId !== context.expectedRuleId) issue("rule_mismatch", "ruleId");
      if (value.standardId !== context.catalog.standardId) issue("wrong_standard", "standardId");
      if (value.standardVersion !== context.catalog.standardVersion) issue("wrong_version", "standardVersion");
      for (const key of ["evidenceDescription", "notes"] as const)
        if (!text(value[key])) issue("missing_required_text", key);
      if (!["confirmed", "rejected", "incomplete", "unavailable"].includes(value.evidenceStatus as string))
        issue("invalid_status", "evidenceStatus");
      if (!record(value.suppliedBy) || !text(value.suppliedBy.nameOrPilotIdentifier))
        issue("missing_supplier", "suppliedBy");
      if (!record(value.suppliedBy) || value.suppliedBy.identityVerified !== false
        || ("identity" in value.suppliedBy && value.suppliedBy.identity !== "unverified"))
        issue("verified_identity_claim", "suppliedBy.identityVerified");
      const validScope = scope(value.scope);
      if (!validScope || !sameScope(value.scope as EvidenceScope, context.expectedScope))
        issue("scope_mismatch", "scope");
      for (const key of ["suppliedAtEpochMs", "validFromEpochMs"] as const) {
        if (!time(value[key])) issue("invalid_timestamp", key);
        else if (value[key] > context.nowEpochMs) issue("future_timestamp", key);
      }
      if (value.expiresAtEpochMs !== null) {
        if (!time(value.expiresAtEpochMs)) issue("invalid_timestamp", "expiresAtEpochMs");
        else if (value.expiresAtEpochMs <= context.nowEpochMs) issue("expired_evidence", "expiresAtEpochMs");
        else if (time(value.validFromEpochMs) && value.expiresAtEpochMs <= value.validFromEpochMs)
          issue("invalid_validity_window", "expiresAtEpochMs");
      }
      for (const key of ["sourceReference", "attachmentReference"] as const)
        if (value[key] !== null && (!validScope || !reference(value[key], value.scope as EvidenceScope)))
          issue("malformed_reference", key);
      if (context.referenceRequired && value.sourceReference === null && value.attachmentReference === null)
        issue("missing_reference", "sourceReference");
      const b = value.binding;
      if (!record(b)) issue("invalid_binding", "binding");
      else {
        if (b.inputSnapshotVersion !== context.expectedInputSnapshotVersion || b.artifactVersion !== context.expectedArtifactVersion)
          issue("binding_mismatch", "binding");
        if (!["complete", "partial", "unknown"].includes(b.snapshotCompleteness as string))
          issue("invalid_completeness", "binding.snapshotCompleteness");
        if (!time(b.reviewedAtEpochMs) || b.reviewedAtEpochMs > context.nowEpochMs)
          issue("invalid_timestamp", "binding.reviewedAtEpochMs");
        for (const key of ["observationFromEpochMs", "observationThroughEpochMs"] as const)
          if (b[key] !== null && (!time(b[key]) || b[key] > context.nowEpochMs))
            issue("invalid_timestamp", `binding.${key}`);
        if ((b.observationFromEpochMs === null) !== (b.observationThroughEpochMs === null)
          || (time(b.observationFromEpochMs) && time(b.observationThroughEpochMs) && b.observationFromEpochMs > b.observationThroughEpochMs)
          || (time(b.observationThroughEpochMs) && time(b.reviewedAtEpochMs) && b.observationThroughEpochMs > b.reviewedAtEpochMs))
          issue("invalid_observation_window", "binding");
      }
      if (issues.length === initial && record(b)) {
        // Whitelist fields: never retain arbitrary mutable user objects or attachment payloads.
        const s = value.scope as unknown as EvidenceScope;
        copied.push({
          evidenceId: value.evidenceId, ruleId: value.ruleId, standardId: value.standardId,
          standardVersion: value.standardVersion, evidenceStatus: value.evidenceStatus,
          evidenceDescription: value.evidenceDescription,
          suppliedBy: { nameOrPilotIdentifier: (value.suppliedBy as Record<string, unknown>).nameOrPilotIdentifier, identityVerified: false },
          suppliedAtEpochMs: value.suppliedAtEpochMs, sourceReference: value.sourceReference,
          attachmentReference: value.attachmentReference, validFromEpochMs: value.validFromEpochMs,
          expiresAtEpochMs: value.expiresAtEpochMs, notes: value.notes,
          scope: { eventId: s.eventId, sessionIds: [...s.sessionIds], participantIds: [...s.participantIds], communicationIds: [...s.communicationIds], deliverableIds: [...s.deliverableIds] },
          binding: {
            inputSnapshotVersion: b.inputSnapshotVersion, artifactVersion: b.artifactVersion,
            reviewedAtEpochMs: b.reviewedAtEpochMs, snapshotCompleteness: b.snapshotCompleteness,
            observationFromEpochMs: b.observationFromEpochMs, observationThroughEpochMs: b.observationThroughEpochMs,
          },
        } as ManualEvidence);
      }
    });
    return issues.length ? frozen({ ok: false, issues }) : frozen({ ok: true, evidence: copied });
  } catch {
    add("invalid_evidence", "evidence");
    return frozen({ ok: false, issues });
  }
}

export function validateManualEvidence(input: unknown, context: EvidenceValidationContext): EvidenceValidationResult {
  const result = validateManualEvidenceCollection([input], context);
  return result.ok ? frozen({ ok: true, evidence: result.evidence[0] }) : result;
}