import type {
  CommunicationContext, EvaluationContext, GovernedValueEvidence,
  HumanConfirmation, RuleEvaluator, RuleFinding,
} from "./types";

export const IMPLEMENTED_RULE_IDS = Object.freeze([
  "WEB-REC-005", "WEB-REC-008", "WEB-FU-INT-001", "WEB-REC-011",
  "WEB-WIN-006", "WEB-FU-VAR-001", "WEB-FU-UNK-002", "WEB-QA-003",
  "WEB-RDY-REC-002", "WEB-QA-004", "WEB-RDY-RUN-001", "WEB-SETUP-C07",
  "WEB-QA-005", "WEB-QA-006", "WEB-RDY-REC-008",
] as const);

type ImplementedRuleId = (typeof IMPLEMENTED_RULE_IDS)[number];
const text = (value: string): boolean => typeof value === "string" && value.trim().length > 0;
const finite = (value: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

function finding(
  status: RuleFinding["status"], reason: RuleFinding["reason"], ...evidence: string[]
): RuleFinding {
  return Object.freeze({ status, reason, evidence: Object.freeze(evidence) });
}
const pass = (...details: string[]) => finding("pass", "satisfied", ...details);
const missing = (...details: string[]) => finding("fail", "missing_evidence", ...details);
const violation = (...details: string[]) => finding("fail", "violation", ...details);
const na = (...details: string[]) => finding("not_applicable", "condition_not_met", ...details);
const invalid = (...details: string[]) => finding("fail", "invalid_context", ...details);

/** Structural checks do not infer policy from event status or use a clock. */
function validateContext(context: EvaluationContext): RuleFinding | null {
  if (!finite(context.observedAtEpochMs)) return invalid("Observation time must be finite.");
  if (!context.event || !text(context.event.eventId)
    || !["draft", "open_for_registration", "scheduled", "in_progress", "completed", "cancelled"]
      .includes(context.event.operationalStatus)) return invalid("Invalid event identity or operational status.");
  if (context.event.startsAtEpochMs !== null && !finite(context.event.startsAtEpochMs)) {
    return invalid("Supplied event start time must be finite.");
  }
  if (!Array.isArray(context.communications) || !context.consent || !context.governance || !context.followUp) {
    return invalid("Required context structures are missing.");
  }
  const participant = context.participant;
  if (participant !== null && (!participant || !text(participant.participantId)
    || participant.eventId !== context.event.eventId
    || !["not_registered", "registered", "waitlisted", "cancelled"].includes(participant.registrationStatus)
    || !["attended", "absent", "unknown"].includes(participant.attendanceState)
    || !["customer", "internal", "test"].includes(participant.audienceClass)
    || ![true, false, null].includes(participant.includedInAttendance)
    || ![true, false, null].includes(participant.includedInReporting))) {
    return invalid("Selected participant has invalid fields or does not belong to the event.");
  }
  const ids = new Set<string>();
  for (const communication of context.communications) {
    if (!communication || !text(communication.communicationId) || !text(communication.eventId)
      || !Array.isArray(communication.recipientIds) || !communication.recipientIds.every(text)
      || !["recruitment", "registrant", "follow_up"].includes(communication.kind)
      || !["planned", "recorded", "omitted"].includes(communication.state)
      || !["attended", "absent", "neutral", null].includes(communication.variant)
      || ![true, false, null].includes(communication.utmRequired)) {
      return invalid("Communication structure is invalid.");
    }
    if (ids.has(communication.communicationId)) {
      return invalid(`Duplicate communication ID: ${communication.communicationId}.`);
    }
    ids.add(communication.communicationId);
  }
  return null;
}

function checked(evaluator: RuleEvaluator): RuleEvaluator {
  return (context) => validateContext(context) ?? evaluator(context);
}

function scoped(context: EvaluationContext, participantOnly = false): readonly CommunicationContext[] {
  return context.communications.filter((communication) =>
    communication.eventId === context.event.eventId && communication.state !== "omitted"
    && (!participantOnly || communication.recipientIds.includes(context.participant!.participantId)));
}

function confirmation(value: HumanConfirmation | null, label: string): RuleFinding {
  if (!value || !text(value.evidence)) return missing(`${label}: human confirmation evidence is missing.`);
  return value.confirmed === true
    ? pass(`${label}: confirmed with evidence: ${value.evidence}`)
    : violation(`${label}: not positively confirmed.`);
}

function governed(value: GovernedValueEvidence | null, label: string): RuleFinding {
  if (!value || !text(value.value)) return missing(`${label}: governed value is missing.`);
  if (value.source !== "foundation" || value.verified !== true) {
    return violation(`${label}: value must be foundation-generated and verified.`);
  }
  return pass(`${label}: verified foundation value ${value.value}.`);
}

const recruitmentSuppression: RuleEvaluator = (context) => {
  if (!context.participant) return missing("A selected participant is required.");
  if (context.participant.registrationStatus !== "registered") return na("Participant is not registered.");
  const conflicts = scoped(context, true).filter((c) => c.kind === "recruitment" && c.state === "planned");
  return conflicts.length
    ? violation(...conflicts.map((c) => `${c.communicationId}: registered participant remains in planned recruitment.`))
    : pass("Registered participant is excluded from all remaining planned recruitment, including overdue plans.");
};

function internalExclusion(includeAttendanceAndReporting: boolean): RuleEvaluator {
  return (context) => {
    const participant = context.participant;
    if (!participant) return missing("A selected participant is required.");
    if (participant.audienceClass === "customer") return na("Participant is not internal or test.");
    const conflicts = scoped(context, true).filter((c) => c.kind === "recruitment"
      || (includeAttendanceAndReporting && c.kind === "follow_up"));
    if (conflicts.length) return violation(...conflicts.map((c) =>
      `${c.communicationId}: internal/test participant is included in ${c.state} ${c.kind}.`));
    if (includeAttendanceAndReporting) {
      if (participant.includedInAttendance === true || participant.includedInReporting === true) {
        return violation("Internal/test participant is included in attendance or reporting.");
      }
      if (participant.includedInAttendance !== false || participant.includedInReporting !== false) {
        return missing("Attendance and reporting exclusion must both be explicitly false.");
      }
    }
    return pass("Internal/test participant is excluded from the applicable communications"
      + (includeAttendanceAndReporting ? ", attendance and reporting." : "."));
  };
}

const noBackdated: RuleEvaluator = (context) => {
  const communications = scoped(context);
  for (const c of communications) {
    if (!finite(c.scheduledAtEpochMs)) {
      return c.scheduledAtEpochMs === null
        ? missing(`${c.communicationId}: scheduled timestamp is missing.`)
        : invalid(`${c.communicationId}: scheduled timestamp must be finite.`);
    }
    const reference = c.state === "recorded" ? c.recordedAtEpochMs : context.observedAtEpochMs;
    if (!finite(reference)) return reference === null
      ? missing(`${c.communicationId}: recorded timestamp is missing.`)
      : invalid(`${c.communicationId}: recorded timestamp must be finite.`);
    if (c.scheduledAtEpochMs < reference) {
      return violation(`${c.communicationId}: scheduled timestamp ${c.scheduledAtEpochMs} precedes `
        + `${c.state === "recorded" ? "recorded" : "observation"} timestamp ${reference}.`);
    }
  }
  return pass("All scoped planned/recorded communications have non-backdated scheduled timestamps.");
};

const eventStarted: RuleEvaluator = (context) => {
  const start = context.event.startsAtEpochMs;
  const started = ["in_progress", "completed"].includes(context.event.operationalStatus)
    || (finite(start) && start <= context.observedAtEpochMs);
  if (!started) {
    if (start === null) return missing("Event start timestamp is needed to determine whether recruitment is still allowed.");
    return na("The event has not started.");
  }
  const communications = scoped(context).filter((c) => c.kind === "recruitment");
  for (const c of communications) {
    if (c.state === "planned") return violation(`${c.communicationId}: planned recruitment remains for a started event.`);
    if (start === null || c.createdAtEpochMs === null) {
      return missing(`${c.communicationId}: event start and recruitment creation timestamps are required for historical evidence.`);
    }
    if (!finite(c.createdAtEpochMs)) return invalid(`${c.communicationId}: creation timestamp must be finite.`);
    if (c.createdAtEpochMs >= start) {
      return violation(`${c.communicationId}: recorded recruitment was created at or after the event start.`);
    }
  }
  return pass("No planned recruitment remains; any recorded recruitment was created before the event started.");
};

const distinctVariants: RuleEvaluator = (context) => {
  const { attended, absent, distinctContentConfirmation } = context.followUp;
  if (!attended || !absent) return na("Both attended and absent follow-up variants are not configured.");
  if (!text(attended.variantId) || !text(absent.variantId)
    || !text(attended.messageContent) || !text(absent.messageContent)) {
    return missing("Both configured variants require nonempty variant IDs and message content.");
  }
  if (attended.variantId.trim() === absent.variantId.trim()
    || attended.messageContent.trim() === absent.messageContent.trim()) {
    return violation("Configured attended and absent follow-up must have distinct IDs and content; a shared destination is allowed.");
  }
  return confirmation(distinctContentConfirmation, "Distinct follow-up content");
};

const unknownAttendance: RuleEvaluator = (context) => {
  if (!context.participant) return missing("A selected participant is required.");
  if (context.participant.attendanceState !== "unknown") return na("Selected participant attendance is not unknown.");
  const communications = scoped(context, true).filter((communication) => communication.kind === "follow_up");
  const attended = communications.filter((c) => c.variant === "attended");
  const absent = communications.filter((c) => c.variant === "absent");
  return attended.length && absent.length
    ? violation(...[...attended, ...absent].map((c) =>
      `${c.communicationId}: ${c.state} ${c.variant} communication targets the same unknown-attendance participant.`))
    : pass("No conflicting attended and absent follow-up targets the selected unknown-attendance participant.");
};

const consent: RuleEvaluator = (context) => {
  if (context.consent.required === null) return missing("Consent requirement has not been established.");
  if (context.consent.required === false) return na("Consent language is not required.");
  if (context.consent.required !== true) return invalid("Consent requirement must be true, false, or null.");
  if (context.consent.languageAttached === null) return missing("Required consent language attachment evidence is missing.");
  if (context.consent.languageAttached !== true) return violation("Required consent language is not attached.");
  return confirmation(context.consent.confirmation, "Required consent language");
};

const utms: RuleEvaluator = (context) => {
  const evidence: string[] = [];
  for (const c of scoped(context)) {
    if (c.utmRequired === null) return missing(`${c.communicationId}: UTM applicability is unknown.`);
    if (c.utmRequired === false) continue;
    const result = governed(c.utm, `${c.communicationId}: UTM`);
    if (result.status !== "pass") return result;
    evidence.push(...result.evidence);
  }
  return pass(...(evidence.length ? evidence : ["No scoped communication requires a UTM."]));
};

const namingTracking: RuleEvaluator = (context) => {
  const name = governed(context.governance.internalName, "Internal name");
  if (name.status !== "pass") return name;
  const code = governed(context.governance.campaignCode, "Campaign code");
  if (code.status !== "pass") return code;
  const taxonomy = context.governance.taxonomyValues;
  if (!Array.isArray(taxonomy) || !taxonomy.length) return missing("Nonempty governed taxonomy values are required.");
  const evidence = [...name.evidence, ...code.evidence];
  for (const [index, value] of taxonomy.entries()) {
    const result = governed(value, `Taxonomy value ${index}`);
    if (result.status !== "pass") return result;
    evidence.push(...result.evidence);
  }
  const tracking = utms(context);
  if (tracking.status !== "pass") return tracking;
  return pass(...evidence, ...tracking.evidence);
};

export const EVALUATORS = Object.freeze({
  "WEB-REC-005": checked(recruitmentSuppression),
  "WEB-REC-008": checked(internalExclusion(false)),
  "WEB-FU-INT-001": checked(internalExclusion(true)),
  "WEB-REC-011": checked(noBackdated),
  "WEB-WIN-006": checked(eventStarted),
  "WEB-FU-VAR-001": checked(distinctVariants),
  "WEB-FU-UNK-002": checked(unknownAttendance),
  "WEB-QA-003": checked((c) => confirmation(c.registrationFlowTest, "Registration flow")),
  "WEB-RDY-REC-002": checked((c) => confirmation(c.registrationFlowTest, "Registration flow")),
  "WEB-QA-004": checked((c) => confirmation(c.joinLinkOrVenueTest, "Join link or venue")),
  "WEB-RDY-RUN-001": checked((c) => confirmation(c.joinLinkOrVenueTest, "Join link or venue")),
  "WEB-SETUP-C07": checked(consent),
  "WEB-QA-005": checked(utms),
  "WEB-QA-006": checked((c) => governed(c.governance.internalName, "Internal name")),
  "WEB-RDY-REC-008": checked(namingTracking),
} satisfies Record<ImplementedRuleId, RuleEvaluator>);