// Pure adapters for the guided webinar Setup + Recruitment workspace.
// Nothing here calculates readiness, cadence, or suppression: every value is
// projected from API output. Keep these functions free of React so they can be
// tested directly.
import type {
  WebinarApiFoundationOutput,
  WebinarApiFinding,
  WebinarApiReadinessStage,
  WebinarApiSourceReference, WebinarApiEvidenceList, WebinarApiEvidenceListAvailableSourcesItem,
  WebinarApiEvidenceInputEvidenceType,
  WebinarApiEvidenceInputSourceType,
  WebinarDateImpact,
  WebinarStandardCommunication,
  WebinarSession,
} from '@workspace/api-client-react';

// ---------- Status vocabulary ----------
export type StatusTone = 'complete' | 'attention' | 'blocked' | 'incomplete' | 'info' | 'unavailable' | 'simulation' | 'stale' | 'planned';

export type StatusLabel =
  | 'Complete' | 'Needs attention' | 'Blocked' | 'Incomplete' | 'Ready' | 'Not ready'
  | 'Planned' | 'Suppressed' | 'Overdue' | 'Cancelled' | 'Executed' | 'Unavailable'
  | 'Unsupported' | 'Simulation' | 'Stale' | 'Review required' | 'Not evaluated' | 'Current'
  | 'Overdue unknown' | 'Not overdue' | 'Execution unknown';

export const TONE_FOR_LABEL: Record<StatusLabel, StatusTone> = {
  Complete: 'complete', Ready: 'complete', Current: 'complete', Executed: 'info',
  'Needs attention': 'attention', Overdue: 'attention', 'Review required': 'attention',
  Blocked: 'blocked', 'Not ready': 'blocked',
  Incomplete: 'incomplete', 'Not evaluated': 'incomplete',
  Planned: 'planned', Suppressed: 'unavailable', Cancelled: 'unavailable',
  Unavailable: 'unavailable', Unsupported: 'unavailable',
  'Overdue unknown': 'unavailable', 'Not overdue': 'planned', 'Execution unknown': 'unavailable',
  Simulation: 'simulation', Stale: 'stale',
};

// ---------- Errors ----------
export type ErrorKind =
  | 'validation' | 'not_found' | 'conflict' | 'idempotency_conflict' | 'capability_unavailable'
  | 'provider_not_configured' | 'provider_unavailable' | 'unsupported' | 'stale_input'
  | 'evaluation_incomplete' | 'authorization_unavailable' | 'network' | 'unexpected';

export interface ClassifiedError {
  kind: ErrorKind;
  status: number | null;
  code: string | null;
  field: string | null;
  message: string;
  /** Retrying the exact same request is safe (no invalid input, no conflict). */
  retrySafe: boolean;
  title: string;
  nextAction: string;
}

const CODE_KIND: Record<string, ErrorKind> = {
  VALIDATION_ERROR: 'validation', MISSING_REQUIRED_INPUT: 'validation', NOT_FOUND: 'not_found',
  CONFLICT: 'conflict', IDEMPOTENCY_CONFLICT: 'idempotency_conflict', UNAUTHENTICATED: 'authorization_unavailable',
  UNAUTHORIZED: 'authorization_unavailable', CAPABILITY_UNAVAILABLE: 'capability_unavailable',
  PROVIDER_NOT_CONFIGURED: 'provider_not_configured', PROVIDER_UNAVAILABLE: 'provider_unavailable',
  PROVIDER_RESPONSE_INVALID: 'provider_unavailable', UNSUPPORTED_GOVERNED_OUTPUT: 'unsupported',
  STALE_INPUT: 'stale_input', EVALUATION_INCOMPLETE: 'evaluation_incomplete', INTERNAL_ERROR: 'unexpected',
};

const KIND_COPY: Record<ErrorKind, { title: string; nextAction: string; retrySafe: boolean }> = {
  validation: { title: 'Some details need correcting', nextAction: 'Fix the highlighted fields, then save again.', retrySafe: false },
  not_found: { title: 'Record not found', nextAction: 'Return to the campaign and reopen the webinar activity.', retrySafe: false },
  conflict: { title: 'Someone saved a newer version', nextAction: 'Your changes are kept here. Review the latest version, then reapply your edits.', retrySafe: false },
  idempotency_conflict: { title: 'A different request already used this key', nextAction: 'Start a new request from the latest data.', retrySafe: false },
  capability_unavailable: { title: 'This capability is unavailable', nextAction: 'No action is possible here until the capability is enabled.', retrySafe: false },
  provider_not_configured: { title: 'Provider not configured', nextAction: 'No provider is set up for this output. Nothing to retry.', retrySafe: false },
  provider_unavailable: { title: 'Provider unavailable', nextAction: 'The configured provider did not respond. You can retry once.', retrySafe: true },
  unsupported: { title: 'Unsupported governed output', nextAction: 'This output is not supplied by the Foundation yet.', retrySafe: false },
  stale_input: { title: 'Source changed since you loaded it', nextAction: 'Refresh the latest source data, then try again.', retrySafe: false },
  evaluation_incomplete: { title: 'Evaluation incomplete', nextAction: 'Complete the missing inputs listed below, then evaluate again.', retrySafe: false },
  authorization_unavailable: { title: 'Authorization unavailable', nextAction: 'A trusted identity is required. This workspace cannot provide one.', retrySafe: false },
  network: { title: 'Connection problem', nextAction: 'Check your connection and retry.', retrySafe: true },
  unexpected: { title: 'Something went wrong', nextAction: 'Retry. If it persists, reload the page.', retrySafe: true },
};

export function classifyError(error: unknown): ClassifiedError {
  const e = (error ?? {}) as { status?: number; data?: unknown; message?: string };
  const status = typeof e.status === 'number' ? e.status : null;
  const data = e.data as { error?: unknown } | null | undefined;
  let code: string | null = null;
  let field: string | null = null;
  let message = typeof e.message === 'string' ? e.message : 'Unknown error';
  const inner = data && typeof data === 'object' ? data.error : undefined;
  if (typeof inner === 'string') message = inner;
  else if (inner && typeof inner === 'object') {
    const obj = inner as { code?: unknown; field?: unknown; message?: unknown };
    if (typeof obj.code === 'string') code = obj.code;
    if (typeof obj.field === 'string') field = obj.field;
    if (typeof obj.message === 'string') message = obj.message;
  }
  let kind: ErrorKind;
  if (code && CODE_KIND[code]) kind = CODE_KIND[code];
  else if (status === 400 || status === 422) kind = 'validation';
  else if (status === 404) kind = 'not_found';
  else if (status === 409 || status === 412 || status === 428) kind = 'conflict';
  else if (status === 401 || status === 403) kind = 'authorization_unavailable';
  else if (status === 503) kind = 'capability_unavailable';
  else if (status === null) kind = 'network';
  else kind = 'unexpected';
  const copy = KIND_COPY[kind];
  return { kind, status, code, field, message, retrySafe: copy.retrySafe, title: copy.title, nextAction: copy.nextAction };
}

// ---------- Time ----------
export function formatInstant(instant: string | null | undefined, timeZone: string): string {
  if (!instant) return 'Not scheduled';
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return 'Invalid time';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function formatSessionWhen(session: Pick<WebinarSession, 'sessionDate' | 'startTime' | 'timezone' | 'durationMinutes'>): string {
  return `${session.sessionDate} at ${session.startTime} (${session.timezone}) · ${session.durationMinutes} min`;
}

/** Relative timing text from the engine's locked timing descriptor — never a hardcoded offset. */
export function describeTiming(c: Pick<WebinarStandardCommunication, 'timing'>): string {
  const t = c.timing;
  if (t.kind === 'trigger' || t.direction === 'trigger' || t.unit === 'instant') return 'On trigger';
  const unit = t.unit === 'days' ? (t.offset === 1 ? 'day' : 'days') : (t.offset === 1 ? 'hour' : 'hours');
  return `${t.offset} ${unit} ${t.direction === 'before' ? 'before' : 'after'} event`;
}

// ---------- Recruitment timeline ----------
// Engine authority: this module never compares scheduled instants to a local
// clock. Overdue comes only from the backend date-impact preview (as of its
// calculatedAt). Execution is never inferred from status text: the API exposes
// no execution-evidence or actual-send timestamp, so execution is "unknown".
export type TouchState = 'planned' | 'suppressed' | 'cancelled' | 'skipped' | 'unscheduled';

export const RECRUITMENT_KEYS = ['recruitment_1', 'recruitment_2', 'recruitment_3', 'final_recruitment'] as const;

export function isRecruitmentTouch(c: Pick<WebinarStandardCommunication, 'key'>): boolean {
  return (RECRUITMENT_KEYS as readonly string[]).includes(c.key);
}

/** Map explicit engine scheduled.status values to a plan state. Never "sent", never "overdue". */
export function touchState(c: Pick<WebinarStandardCommunication, 'scheduled'>): TouchState {
  const s = (c.scheduled?.status ?? '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'suppressed') return 'suppressed';
  if (s === 'skipped' || c.scheduled?.skipReason) return 'skipped';
  if (!(c.scheduled?.effectiveAt ?? c.scheduled?.currentAt)) return 'unscheduled';
  return 'planned';
}

export const TOUCH_STATE_LABEL: Record<TouchState, StatusLabel> = {
  planned: 'Planned', suppressed: 'Suppressed', cancelled: 'Cancelled', skipped: 'Suppressed', unscheduled: 'Incomplete',
};

/** Authoritative overdue annotations from a backend date-impact preview of the current values. */
export interface OverdueAuthority { calculatedAt: string; byKey: Record<string, { overdue: boolean; shortenedWindow: boolean }> }

export function overdueAuthorityFromPreview(p: Pick<WebinarDateImpact, 'calculatedAt' | 'touches'>): OverdueAuthority {
  const byKey: OverdueAuthority['byKey'] = {};
  for (const t of p.touches) byKey[t.key] = { overdue: t.previous.overdue, shortenedWindow: t.shortenedWindow };
  return { calculatedAt: p.calculatedAt, byKey };
}

/** 'Overdue' | 'Not overdue' only with backend authority for this key; otherwise 'Overdue unknown'. */
export function overdueLabel(key: string, auth: OverdueAuthority | null): StatusLabel {
  const e = auth?.byKey[key];
  if (!e) return 'Overdue unknown';
  return e.overdue ? 'Overdue' : 'Not overdue';
}

/** No API field carries execution evidence or an actual timestamp, so execution is always unknown. */
export const EXECUTION_EVIDENCE_AVAILABLE = false as const;
export function executionLabel(): StatusLabel { return 'Execution unknown'; }

/** Engine order only: sortOrder, then key as a stable tie-break. No local scheduling. */
export function orderTimeline<T extends Pick<WebinarStandardCommunication, 'sortOrder' | 'key'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function findingsForKey(findings: readonly WebinarApiFinding[], key: string, id: string): WebinarApiFinding[] {
  return findings.filter((f) => f.evidence.some((e) => e.includes(key) || e.includes(id)));
}

export interface RecruitmentCounts {
  planned: number;
  /** Informational only: plans that have content and a destination. Not an engine completeness result. */
  withContentAndDestination: number;
  missingDestination: number; missingContent: number; suppressed: number;
  /** null = no authoritative overdue status available. */
  overdue: number | null;
}

export function recruitmentCounts(items: readonly WebinarStandardCommunication[], auth: OverdueAuthority | null): RecruitmentCounts {
  const counts: RecruitmentCounts = { planned: 0, withContentAndDestination: 0, missingDestination: 0, missingContent: 0, suppressed: 0, overdue: auth ? 0 : null };
  for (const c of items) {
    const state = touchState(c);
    if (state === 'planned') counts.planned += 1;
    if (state === 'suppressed' || state === 'skipped' || state === 'cancelled') counts.suppressed += 1;
    if (auth) { const e = auth.byKey[c.key]; if (!e) counts.overdue = null; else if (e.overdue && counts.overdue !== null) counts.overdue += 1; }
    const noDest = c.ctas.length === 0 || c.ctas.some((cta) => !cta.destinationUrl || cta.destinationError);
    const noContent = !c.variants.some((v) => v.validation.valid);
    if (noDest) counts.missingDestination += 1;
    if (noContent) counts.missingContent += 1;
    if (!noDest && !noContent) counts.withContentAndDestination += 1;
  }
  return counts;
}

// ---------- Readiness ----------
export function stageNamed(stages: readonly WebinarApiReadinessStage[] | undefined, name: WebinarApiReadinessStage['stage']) {
  return stages?.find((s) => s.stage === name);
}

/** Display label for an engine stage status; UI never computes readiness itself. */
export function stageLabel(stage: Pick<WebinarApiReadinessStage, 'status' | 'fullyEvaluated'> | undefined): StatusLabel {
  if (!stage) return 'Not evaluated';
  if (stage.status === 'ready') return 'Ready';
  if (stage.status === 'blocked') return 'Blocked';
  return 'Incomplete';
}

export interface ExceptionEligibility { eligible: boolean; reason: string }

export function exceptionEligibility(finding: WebinarApiFinding, isBlocking: boolean): ExceptionEligibility {
  if (!isBlocking) return { eligible: false, reason: 'Nonblocking findings do not need an exception.' };
  if (finding.status !== 'fail') return { eligible: false, reason: 'Only a currently failed blocker can be referenced.' };
  if (finding.ruleId === 'WEB-EXC-001') return { eligible: false, reason: 'This rule governs exceptions and cannot exempt itself.' };
  if (!finding.rule.exceptionEligible) return { eligible: false, reason: finding.rule.exceptionEligibleNote ?? 'The standard does not allow exceptions for this rule.' };
  return { eligible: true, reason: finding.rule.exceptionEligibleNote ?? 'The standard allows a draft exception request for this blocker.' };
}

// ---------- Evidence ----------
export interface EvidenceSourceChoice {
  value: string;
  sourceId: string;
  sourceType: WebinarApiEvidenceInputSourceType;
  sourceVersion: string;
  sourceHash: string;
  label: string;
}

const SOURCE_TYPES: readonly string[] = ['occurrence', 'content', 'foundation', 'delivery', 'measurement'];
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

/** Exact immutable row refs from GET evidence (generated contract). null while the response is loading. */
export function availableSourcesOf(evidence: WebinarApiEvidenceList | undefined): readonly WebinarApiEvidenceListAvailableSourcesItem[] | null {
  return evidence ? evidence.availableSources : null;
}

/** Only sources that the API reported with an exact typed version and hash may be referenced. */
export function evidenceSourceChoices(refs: readonly WebinarApiEvidenceListAvailableSourcesItem[], evidenceType: WebinarApiEvidenceInputEvidenceType): EvidenceSourceChoice[] {
  const allowed = evidenceType === 'qa' ? ['content', 'occurrence'] : evidenceType === 'manual-review' ? ['content'] : SOURCE_TYPES;
  const seen = new Set<string>();
  const out: EvidenceSourceChoice[] = [];
  for (const r of refs) {
    if (r.usable !== true) continue; // server says expired/missing/otherwise unusable — never offer
    if (!SOURCE_TYPES.includes(r.sourceType) || !allowed.includes(r.sourceType)) continue;
    if (!r.sourceVersion || !r.sourceHash || !VERSION_RE.test(r.sourceVersion) || !HASH_RE.test(r.sourceHash)) continue;
    const value = `${r.sourceType}:${r.sourceId}:${r.sourceVersion}`;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, sourceId: r.sourceId, sourceType: r.sourceType, sourceVersion: r.sourceVersion, sourceHash: r.sourceHash, label: `${r.sourceType} · ${r.sourceId.slice(0, 8)} · v${r.sourceVersion}` });
  }
  return out;
}

// ---------- Foundation capability ----------
export type CapabilityState =
  | 'available-synthetic' | 'available-live' | 'configured_but_unavailable' | 'not_configured'
  | 'unsupported' | 'invalid_response' | 'stale' | 'refreshing' | 'refresh_failed';

export const CAPABILITY_LABEL: Record<CapabilityState, string> = {
  'available-synthetic': 'Available — simulation',
  'available-live': 'Available — live provider',
  configured_but_unavailable: 'Configured but unavailable',
  not_configured: 'Provider not configured',
  unsupported: 'Unsupported',
  invalid_response: 'Invalid response',
  stale: 'Stale',
  refreshing: 'Refresh in progress',
  refresh_failed: 'Refresh failed',
};

export const CAPABILITY_NAME: Record<WebinarApiFoundationOutput['type'], string> = {
  taxonomy: 'Taxonomy', internal_title: 'Standardized naming', campaign_code: 'Campaign code',
  utm: 'UTM output', objective_membership: 'Objective', campaign_exclusion: 'Exclusions',
};

export function capabilityState(output: Pick<WebinarApiFoundationOutput, 'status' | 'availableFromRealProvider' | 'error'> | undefined, opts: { refreshing?: boolean; refreshFailed?: boolean } = {}): CapabilityState {
  if (opts.refreshing) return 'refreshing';
  if (opts.refreshFailed) return 'refresh_failed';
  if (!output) return 'unsupported';
  switch (output.status) {
    case 'available-synthetic': return output.availableFromRealProvider ? 'available-live' : 'available-synthetic';
    case 'configured_but_unavailable': return 'configured_but_unavailable';
    case 'not_configured': return 'not_configured';
    case 'stale': return 'stale';
    case 'failed': return output.error && /invalid/i.test(output.error) ? 'invalid_response' : 'configured_but_unavailable';
    default: return 'unsupported';
  }
}

// ---------- Dirty tracking ----------
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function isDirty(baseline: unknown, draft: unknown): boolean {
  return stableStringify(baseline) !== stableStringify(draft);
}

/** Only the fields a user actually changed, for a minimal PATCH. */
export function changedFields<T extends Record<string, unknown>>(baseline: T, draft: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(draft) as (keyof T)[]) {
    if (stableStringify(baseline[k]) !== stableStringify(draft[k])) out[k] = draft[k];
  }
  return out;
}

export const TIMING_FIELDS = ['sessionDate', 'startTime', 'durationMinutes', 'timezone', 'recruitmentLaunchAt'] as const;

export function touchesTiming(changes: Record<string, unknown>): boolean {
  return TIMING_FIELDS.some((f) => f in changes);
}

// ---------- Date impact ----------
export interface DateImpactSummary {
  changed: WebinarDateImpact['touches'];
  newlyOverdue: WebinarDateImpact['touches'];
  shortened: WebinarDateImpact['touches'];
  unchanged: WebinarDateImpact['touches'];
  requiresConfirmation: boolean;
}

export function summarizeDateImpact(impact: WebinarDateImpact): DateImpactSummary {
  const changed = impact.touches.filter((t) => t.changed);
  const newlyOverdue = impact.touches.filter((t) => t.proposed.overdue && !t.previous.overdue);
  const shortened = impact.touches.filter((t) => t.shortenedWindow);
  const unchanged = impact.touches.filter((t) => !t.changed);
  return { changed, newlyOverdue, shortened, unchanged, requiresConfirmation: changed.length > 0 || newlyOverdue.length > 0 || shortened.length > 0 || impact.warnings.length > 0 };
}

// ---------- Staleness ----------
export type Freshness = 'current' | 'stale' | 'not_evaluated' | 'stale_pending_save';

export function freshness(apiStaleness: 'current' | 'stale' | 'not_evaluated' | undefined, localChangeSinceEval: boolean): Freshness {
  if (localChangeSinceEval) return 'stale_pending_save';
  return apiStaleness ?? 'not_evaluated';
}

export const FRESHNESS_LABEL: Record<Freshness, StatusLabel> = {
  current: 'Current', stale: 'Stale', not_evaluated: 'Not evaluated', stale_pending_save: 'Stale',
};

// ---------- Setup steps ----------
export const SETUP_STEPS = [
  { id: 'why', label: 'Why', hint: 'Objective and purpose' },
  { id: 'who', label: 'Who', hint: 'Audience' },
  { id: 'what', label: 'What', hint: 'Webinar and content' },
  { id: 'when', label: 'When', hint: 'Date and timing' },
  { id: 'where', label: 'Where', hint: 'Delivery location' },
  { id: 'how', label: 'How', hint: 'Operating plan' },
  { id: 'review', label: 'Review', hint: 'Setup findings' },
] as const;
export type SetupStepId = typeof SETUP_STEPS[number]['id'];

/** Map an API field or missing-input name to the Setup step where it is addressed. */
export function stepForField(field: string): SetupStepId {
  const f = field.toLowerCase();
  if (/(objective|measure|campaign)/.test(f)) return 'why';
  if (/(audience|exclu|suppress|registr|segment|variant|population)/.test(f)) return 'who';
  if (/(name|title|speaker|content|asset|cta|subject|copy|deliverable)/.test(f)) return 'what';
  if (/(date|time|zone|duration|launch|window|schedul)/.test(f)) return 'when';
  if (/(platform|provider|venue|destination|url|join|utm)/.test(f)) return 'where';
  return 'how';
}

export const ANALYTICS_EVENTS = [
  'webinar_setup_started', 'webinar_setup_section_completed', 'webinar_setup_validation_failed',
  'webinar_recruitment_viewed', 'webinar_communication_expanded', 'webinar_guidance_opened',
  'webinar_evidence_workflow_started', 'webinar_evaluation_requested', 'webinar_error_encountered',
  'webinar_workflow_abandoned_unsaved',
] as const;

/** Readiness is always presented with explicit simulation / non-operational context. */
export function simulationReadinessText(stage: Pick<WebinarApiReadinessStage, 'status' | 'fullyEvaluated'> | undefined): string {
  return `Simulation readiness (non-operational): ${stageLabel(stage)}`;
}
