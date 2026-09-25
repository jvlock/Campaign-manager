import { useMemo, useRef, useEffect, type ReactNode } from 'react';
import { Target, Users, FileText, CalendarDays, MapPin, Settings2, ClipboardCheck, Plus, Trash2, AlertTriangle, Save } from 'lucide-react';
import type {
  WebinarApiSummary, WebinarApiReadinessStage, WebinarStandard, WebinarSession, WebinarApiFinding, CampaignDetail, WebinarDateImpact,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusChip, CapabilityStatus, ExplainTerm, RegionError } from './status';
import {
  SETUP_STEPS, stepForField, describeTiming, formatInstant, orderTimeline, isRecruitmentTouch, summarizeDateImpact,
  type SetupStepId, type ClassifiedError, type StatusLabel,
} from '@/lib/webinar-workspace/adapters';
import { ruleRoute, type RuleRoute } from '@/lib/webinar-workspace/rule-routes';

export interface SessionDraft {
  name: string; sessionDate: string; startTime: string; durationMinutes: string; timezone: string;
  platform: string; speakers: { name: string; role: string; organization: string }[]; recruitmentLaunchLocal: string;
}
export interface VariantDraft { slot: number; name: string; inUse: boolean; audienceDefinition: string; messageAngle: string; valueProposition: string }

export const STEP_ICON: Record<SetupStepId, typeof Target> = { why: Target, who: Users, what: FileText, when: CalendarDays, where: MapPin, how: Settings2, review: ClipboardCheck };

export const PLATFORM_OPTIONS = [
  { value: 'zoom', label: 'Zoom' }, { value: 'teams', label: 'Microsoft Teams' }, { value: 'webex', label: 'Webex' }, { value: 'on24', label: 'ON24' },
];
export const DURATION_PRESETS = ['30', '45', '60', '90', '120'];

export function timezoneOptions(current: string): string[] {
  let zones: string[] = [];
  try { zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []; } catch { zones = []; }
  if (zones.length === 0) zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney'];
  if (!zones.includes('UTC')) zones = ['UTC', ...zones];
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

export type FieldErrors = Partial<Record<string, string>>;

export function validateStep(step: SetupStepId, d: SessionDraft, variants: VariantDraft[]): FieldErrors {
  const e: FieldErrors = {};
  if (step === 'what') {
    d.speakers.forEach((s, i) => { if ((s.role || s.organization) && !s.name.trim()) e[`speaker-${i}`] = `Speaker ${i + 1} needs a name, or remove the row.`; });
  }
  if (step === 'when') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.sessionDate)) e.sessionDate = 'Choose the event date.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime)) e.startTime = 'Choose a start time (HH:MM).';
    const dur = Number(d.durationMinutes);
    if (!Number.isInteger(dur) || dur < 1 || dur > 1440) e.durationMinutes = 'Duration must be 1–1440 whole minutes.';
    if (!d.timezone) e.timezone = 'Choose a time zone. It is never inferred.';
  }
  if (step === 'who') {
    if (!variants.some((v) => v.inUse)) e['variant-0'] = 'Keep at least one audience variant in use.';
    variants.forEach((v, i) => { if (v.inUse && !v.audienceDefinition.trim()) e[`variant-${i}`] = `Describe the audience for “${v.name}”.`; });
  }
  if (step === 'where' && !d.platform) e.platform = 'Choose the webinar platform.';
  return e;
}

export const FIELD_STEP: Record<string, SetupStepId> = { name: 'what', sessionDate: 'when', startTime: 'when', durationMinutes: 'when', timezone: 'when', recruitmentLaunchAt: 'when', platform: 'where', speakers: 'what', registrationRule: 'who' };
export function fieldToStep(field: string): SetupStepId { return FIELD_STEP[field] ?? stepForField(field); }

/** Explicit canonical rule-ID routing (presentation only). */
export function findingRoute(f: Pick<WebinarApiFinding, 'ruleId'>): RuleRoute | 'review' { return ruleRoute(f.ruleId); }
export function findingStep(f: Pick<WebinarApiFinding, 'ruleId'>): SetupStepId { const r = ruleRoute(f.ruleId); return r === 'recruitment' ? 'review' : r; }

export function stepStatus(step: SetupStepId, stage: WebinarApiReadinessStage | undefined, dirty: boolean): StatusLabel {
  if (dirty) return 'Needs attention';
  if (!stage || stage.staleness === 'not_evaluated') return 'Not evaluated';
  if (stage.unresolvedBlockingFailures.some((f) => findingStep(f) === step)) return 'Blocked';
  if ([...stage.warnings, ...stage.nonblockingFailures].some((f) => findingStep(f) === step)) return 'Needs attention';
  if (stage.missingInputs.some((m) => stepForField(m.field) === step)) return 'Incomplete';
  if (stage.staleness === 'stale') return 'Stale';
  return 'Complete';
}

// ---------------- Error summary ----------------
export function ErrorSummary({ errors, serverError, summaryRef, onRetry }: { errors: FieldErrors; serverError: ClassifiedError | null; summaryRef: React.RefObject<HTMLDivElement | null>; onRetry?: () => void }) {
  const entries = Object.entries(errors).filter(([, v]) => v);
  if (entries.length === 0 && !serverError) return null;
  return (
    <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="ww-errsum-h" className="ww-region-error flex-col" data-testid="error-summary">
      <p id="ww-errsum-h" className="font-semibold">{serverError ? serverError.title : `There ${entries.length === 1 ? 'is 1 problem' : `are ${entries.length} problems`} to fix`}</p>
      {serverError && <p className="text-sm">{serverError.message} — {serverError.nextAction}</p>}
      {entries.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {entries.map(([k, v]) => <li key={k}><a className="underline" href={`#ww-f-${k}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(`ww-f-${k}`)?.focus(); }}>{v}</a></li>)}
        </ul>
      )}
      {serverError?.retrySafe && onRetry && <button type="button" className="ww-link-btn self-start text-sm" onClick={onRetry}>Retry save</button>}
    </div>
  );
}

function FieldError({ id, msg }: { id: string; msg?: string }) {
  return msg ? <p id={`ww-f-${id}-err`} className="text-sm font-medium text-[hsl(var(--ww-red-800))]"><AlertTriangle aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />{msg}</p> : null;
}
function errProps(id: string, errors: FieldErrors) {
  return { id: `ww-f-${id}`, 'aria-invalid': !!errors[id] || undefined, 'aria-describedby': errors[id] ? `ww-f-${id}-err` : undefined };
}

function StepHeading({ step, why, children }: { step: SetupStepId; why: string; children?: ReactNode }) {
  const meta = SETUP_STEPS.find((s) => s.id === step)!;
  const Icon = STEP_ICON[step];
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: false }); }, [step]);
  return (
    <header className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--ww-green-700))]">Setup · {meta.label}</p>
      <h2 ref={ref} tabIndex={-1} className="mt-1 flex items-center gap-2 text-xl font-semibold outline-none"><Icon aria-hidden="true" className="h-5 w-5" />{meta.hint}</h2>
      <details className="mt-2 text-sm text-muted-foreground"><summary className="ww-target inline-flex cursor-pointer items-center font-medium text-foreground">Why this matters</summary><p className="mt-1">{why}</p></details>
      {children}
    </header>
  );
}

function ReadOnlyFact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return <div className="rounded-md border border-border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>;
}

// ---------------- Step bodies ----------------
export interface StepProps {
  campaign: CampaignDetail | undefined; session: WebinarSession; standard: WebinarStandard | undefined; summary: WebinarApiSummary | undefined;
  stage: WebinarApiReadinessStage | undefined; draft: SessionDraft; setDraft: (d: SessionDraft) => void;
  variants: VariantDraft[]; setVariants: (v: VariantDraft[]) => void; errors: FieldErrors;
  goTo: (s: SetupStepId) => void; openRecruitment?: () => void; foundationRefreshing?: boolean; foundationRefreshFailed?: boolean;
}

const out = (s: WebinarApiSummary | undefined, t: 'taxonomy' | 'internal_title' | 'campaign_code' | 'utm' | 'objective_membership' | 'campaign_exclusion') => s?.foundation.outputs.find((o) => o.type === t);

export function WhyStep({ campaign, summary }: StepProps) {
  return (
    <div>
      <StepHeading step="why" why="The objective connects this webinar to a campaign outcome and to how success will be measured. Governed objectives come from the Foundation so every campaign reports the same way." />
      <CapabilityStatus type="objective_membership" output={out(summary, 'objective_membership')} />
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <ReadOnlyFact label="Campaign" value={campaign?.name ?? 'Loading campaign…'} />
        <ReadOnlyFact label="Webinar objective" value="Unavailable — not Foundation governed" note="No authorized objective field exists for webinars, and the governed objective output is unsupported. Nothing is invented locally." />
        <ReadOnlyFact label="Measurement intent" value={summary ? `Measurement obligations: unavailable (no operational evidence)` : 'Loading…'} note="Required before operational use: a governed objective from the Foundation and measurement capture." />
      </dl>
    </div>
  );
}

export function WhoStep({ session, summary, variants, setVariants, errors }: StepProps) {
  const reg = summary?.registrationSummary;
  return (
    <div>
      <StepHeading step="who" why="Audience definitions shape each variant, and suppression keeps registered people out of later recruitment. Planned audience is separate from people who actually register." />
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Planned audience variants</legend>
        <p className="text-xs text-muted-foreground">Planning input — not Foundation governed.</p>
        {variants.map((v, i) => (
          <div key={v.slot} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{v.name || `Variant ${v.slot}`}</span>
              <label className="ww-target inline-flex items-center gap-2 text-sm"><Switch checked={v.inUse} onCheckedChange={(c) => setVariants(variants.map((x, j) => j === i ? { ...x, inUse: c } : x))} aria-label={`Use ${v.name || `variant ${v.slot}`}`} />In use</label>
            </div>
            <Label htmlFor={`ww-f-variant-${i}`} className="mt-2 block">Audience definition</Label>
            <Textarea {...errProps(`variant-${i}`, errors)} value={v.audienceDefinition} rows={2} onChange={(e) => setVariants(variants.map((x, j) => j === i ? { ...x, audienceDefinition: e.target.value } : x))} />
            <FieldError id={`variant-${i}`} msg={errors[`variant-${i}`]} />
          </div>
        ))}
      </fieldset>
      <div className={`mt-4 rounded-md border p-3 ${session.registrationRule.suppressRecruitmentAfterRegistration ? 'border-border' : 'border-[hsl(var(--ww-red-800))]'}`} data-testid="status-suppression-canonical">
        <p className="flex flex-wrap items-center gap-2 font-medium">Suppress recruitment after registration <StatusChip label={session.registrationRule.suppressRecruitmentAfterRegistration ? 'Complete' : 'Needs attention'} /><span className="text-xs font-normal text-muted-foreground">Read-only · required by the standard</span></p>
        {session.registrationRule.suppressRecruitmentAfterRegistration
          ? <p className="mt-1 text-xs text-muted-foreground">Registered participants are removed from future recruitment. This is a canonical requirement, so it cannot be turned off here.</p>
          : <p className="mt-1 flex gap-1 text-sm" role="note"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />This webinar has a legacy configuration with suppression disabled. The standard requires suppression; this workspace does not offer a way to keep it disabled or bypass it. Expect a blocking finding until the configuration is corrected by an authorized process.</p>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CapabilityStatus type="campaign_exclusion" output={out(summary, 'campaign_exclusion')} />
        <ReadOnlyFact label="Internal / test exclusion" value="Always excluded (read-only)" note="Internal and test records stay out of recruitment. No control here can include them, and manual input cannot stand in for governed exclusions." />
        <ReadOnlyFact label="Actual registrants (synthetic summary)" value={reg?.status === 'synthetic-recorded' ? `${reg.registered} registered · ${reg.waitlisted} waitlisted · ${reg.cancelled} cancelled` : 'None recorded'} note="Population counts only. No individual customer records are processed." />
        <ReadOnlyFact label="Geography · language · waitlist" value="Unsupported by the webinar model" note="These are not stored for webinars yet, so they are not editable here." />
      </div>
    </div>
  );
}

export function WhatStep({ standard, summary, draft, setDraft, errors }: StepProps) {
  const ctas = useMemo(() => standard?.communications.flatMap((c) => c.ctas.map((x) => ({ ...x, comm: c.name }))) ?? [], [standard]);
  return (
    <div>
      <StepHeading step="what" why="Titles and speakers identify the webinar internally. Governed naming is separate and comes from the Foundation." />
      <div className="space-y-1">
        <p className="text-sm font-medium" id="ww-title-label">Internal working title</p>
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 font-medium break-words" aria-labelledby="ww-title-label" data-testid="text-working-title">{draft.name}</p>
        <p className="text-xs text-muted-foreground">Existing planning title — not Foundation governed. It cannot be edited through the current API. Speakers and hosts below are editable.</p>
      </div>
      <div className="mt-3"><CapabilityStatus type="internal_title" output={out(summary, 'internal_title')} /></div>
      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-semibold">Speakers and hosts</legend>
        {draft.speakers.length === 0 && <p className="text-sm text-muted-foreground">No speakers added.</p>}
        {draft.speakers.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <div><Label htmlFor={`ww-f-speaker-${i}`} className="text-xs">Name</Label><Input {...errProps(`speaker-${i}`, errors)} className="ww-target" value={s.name} onChange={(e) => setDraft({ ...draft, speakers: draft.speakers.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /></div>
            <div><Label htmlFor={`ww-sp-role-${i}`} className="text-xs">Role</Label><Input id={`ww-sp-role-${i}`} className="ww-target" value={s.role} onChange={(e) => setDraft({ ...draft, speakers: draft.speakers.map((x, j) => j === i ? { ...x, role: e.target.value } : x) })} /></div>
            <div><Label htmlFor={`ww-sp-org-${i}`} className="text-xs">Organization</Label><Input id={`ww-sp-org-${i}`} className="ww-target" value={s.organization} onChange={(e) => setDraft({ ...draft, speakers: draft.speakers.map((x, j) => j === i ? { ...x, organization: e.target.value } : x) })} /></div>
            <Button type="button" variant="ghost" className="ww-target self-end" aria-label={`Remove speaker ${i + 1}`} onClick={() => setDraft({ ...draft, speakers: draft.speakers.filter((_, j) => j !== i) })}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
            <div className="sm:col-span-4"><FieldError id={`speaker-${i}`} msg={errors[`speaker-${i}`]} /></div>
          </div>
        ))}
        <Button type="button" variant="outline" className="ww-target" onClick={() => setDraft({ ...draft, speakers: [...draft.speakers, { name: '', role: '', organization: '' }] })}><Plus aria-hidden="true" className="mr-1 h-4 w-4" />Add speaker</Button>
      </fieldset>
      <h3 className="mt-5 text-sm font-semibold">Primary CTAs and registration destinations</h3>
      <p className="text-xs text-muted-foreground">Reused from the campaign’s deliverables. Manage them in the activity’s communication editor; no copy is generated here.</p>
      <ul className="mt-2 space-y-1 text-sm">
        {ctas.length === 0 ? <li className="text-muted-foreground">No CTA linked to any communication yet.</li> : ctas.map((x) => (
          <li key={`${x.comm}-${x.id}`} className="flex flex-wrap items-center gap-2 break-all"><span className="font-medium">{x.comm}</span>· {x.name} · {x.destinationUrl ?? 'no destination'} <StatusChip label={x.destinationUrl && !x.destinationError ? 'Planned' : 'Incomplete'} /></li>
        ))}
      </ul>
    </div>
  );
}

export function WhenStep({ session, standard, draft, setDraft, errors, impact }: StepProps & { impact: WebinarDateImpact | null }) {
  const zones = useMemo(() => timezoneOptions(draft.timezone), [draft.timezone]);
  const preset = DURATION_PRESETS.includes(draft.durationMinutes) ? draft.durationMinutes : 'custom';
  const recruitment = useMemo(() => orderTimeline(standard?.communications ?? []).filter(isRecruitmentTouch), [standard]);
  return (
    <div>
      <StepHeading step="when" why="All recruitment touches are scheduled from the event instant. Changing it can move, shorten, or make touches overdue, so you will see the impact before saving." />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="ww-f-sessionDate">Event date</Label><Input type="date" {...errProps('sessionDate', errors)} className="ww-target" value={draft.sessionDate} onChange={(e) => setDraft({ ...draft, sessionDate: e.target.value })} /><FieldError id="sessionDate" msg={errors.sessionDate} /></div>
        <div className="space-y-1"><Label htmlFor="ww-f-startTime">Start time</Label><Input type="time" {...errProps('startTime', errors)} className="ww-target" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} /><FieldError id="startTime" msg={errors.startTime} /></div>
        <div className="space-y-1">
          <Label htmlFor="ww-f-timezone">Time zone</Label>
          <Select value={draft.timezone} onValueChange={(v) => setDraft({ ...draft, timezone: v })}>
            <SelectTrigger {...errProps('timezone', errors)} className="ww-target"><SelectValue placeholder="Choose a time zone" /></SelectTrigger>
            <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Stored time zone: {session.timezone}. Never inferred from your browser.</p>
          <FieldError id="timezone" msg={errors.timezone} />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Duration</legend>
          <RadioGroup value={preset} onValueChange={(v) => { if (v !== 'custom') setDraft({ ...draft, durationMinutes: v }); }} className="flex flex-wrap gap-1" aria-label="Duration preset">
            {DURATION_PRESETS.map((p) => <label key={p} className="ww-target inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 text-sm"><RadioGroupItem value={p} />{p} min</label>)}
            <label className="ww-target inline-flex items-center gap-1 rounded-md border border-border px-2 text-sm"><RadioGroupItem value="custom" />Custom</label>
          </RadioGroup>
          <Label htmlFor="ww-f-durationMinutes" className="sr-only">Duration in minutes</Label>
          <Input type="number" min={1} max={1440} {...errProps('durationMinutes', errors)} className="ww-target w-32" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: e.target.value })} />
          <FieldError id="durationMinutes" msg={errors.durationMinutes} />
        </fieldset>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="ww-f-recruitmentLaunchAt">Recruitment launch ({draft.timezone || 'choose a time zone'})</Label>
          <Input type="datetime-local" {...errProps('recruitmentLaunchAt', errors)} className="ww-target sm:w-72" value={draft.recruitmentLaunchLocal} onChange={(e) => setDraft({ ...draft, recruitmentLaunchLocal: e.target.value })} />
          <p className="text-xs text-muted-foreground">Currently {formatInstant(session.recruitmentLaunchAt, session.timezone)}. Registration open/close times are not modeled separately.</p>
          <FieldError id="recruitmentLaunchAt" msg={errors.recruitmentLaunchAt} />
        </div>
      </div>
      <h3 className="mt-5 text-sm font-semibold">Current recruitment schedule (from the engine)</h3>
      <ul className="mt-1 space-y-1 text-sm" data-testid="list-when-schedule">
        {recruitment.map((c) => <li key={c.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1"><span>{c.name} · {describeTiming(c)}</span><span className="text-muted-foreground">{formatInstant(c.scheduled.effectiveAt ?? c.scheduled.currentAt, session.timezone)}</span></li>)}
      </ul>
      {impact && <DateImpactList impact={impact} />}
    </div>
  );
}

export function DateImpactList({ impact }: { impact: WebinarDateImpact }) {
  const s = summarizeDateImpact(impact);
  return (
    <div className="mt-3 space-y-2" data-testid="date-impact">
      <p className="text-sm"><strong>{impact.changedCount}</strong> touch{impact.changedCount === 1 ? '' : 'es'} change · <strong>{impact.newlyOverdueCount}</strong> newly overdue · <strong>{impact.shortenedWindowCount}</strong> shortened window</p>
      <ul className="space-y-1 text-sm">
        {impact.touches.map((t) => (
          <li key={t.key} className="rounded-md border border-border p-2" data-testid={`impact-${t.key}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.name}</span>
              {t.changed ? <StatusChip label="Changes" tone="attention" /> : <StatusChip label="Unchanged" tone="unavailable" />}
              {s.newlyOverdue.includes(t) && <StatusChip label="Overdue" testId={`impact-overdue-${t.key}`} />}
              {t.shortenedWindow && <StatusChip label="Shortened window" tone="attention" />}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{formatInstant(t.previous.scheduledAt, impact.timezone)} → {formatInstant(t.proposed.scheduledAt, impact.timezone)}{t.proposed.skipReason ? ` · ${t.proposed.skipReason}` : ''}</p>
          </li>
        ))}
      </ul>
      {impact.warnings.length > 0 && <ul className="space-y-1 text-sm">{impact.warnings.map((w) => <li key={w} className="flex gap-1"><AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>)}</ul>}
      <p className="text-xs text-muted-foreground">{impact.blockers.length === 0 ? 'The scheduler does not classify blockers itself; rule blockers appear after re-evaluation.' : impact.blockers.join(' · ')}</p>
    </div>
  );
}

export function WhereStep({ summary, draft, setDraft, errors }: StepProps) {
  return (
    <div>
      <StepHeading step="where" why="The platform hosts the event. Choosing a platform plans it; it does not connect to it." />
      <fieldset>
        <legend className="text-sm font-semibold">Webinar platform</legend>
        <RadioGroup value={draft.platform} onValueChange={(v) => setDraft({ ...draft, platform: v })} className="mt-2 grid gap-2 sm:grid-cols-2" aria-describedby={errors.platform ? 'ww-f-platform-err' : undefined}>
          {[...PLATFORM_OPTIONS, ...(PLATFORM_OPTIONS.some((p) => p.value === draft.platform) || !draft.platform ? [] : [{ value: draft.platform, label: draft.platform }])].map((p, i) => (
            <label key={p.value} className="ww-target flex cursor-pointer items-center gap-2 rounded-md border border-border p-2"><RadioGroupItem value={p.value} id={i === 0 ? 'ww-f-platform' : undefined} />{p.label}</label>
          ))}
        </RadioGroup>
        <FieldError id="platform" msg={errors.platform} />
      </fieldset>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <ReadOnlyFact label="Format" value="Virtual" note="In-person and hybrid are not modeled for webinars." />
        <ReadOnlyFact label="Provider connection" value={<StatusChip label="Unavailable" />} note="Configured is not connected. No provider connection exists in this development workspace." />
        <ReadOnlyFact label="Join destination" value="Not verified" note="Planned destinations are not verified operational destinations." />
        <ReadOnlyFact label="Delivery scope" value="Read-only" note="Scope is set by the campaign and cannot be edited through this API." />
      </dl>
      <div className="mt-3"><CapabilityStatus type="utm" output={out(summary, 'utm')} /></div>
    </div>
  );
}

export function HowStep({ session, standard, summary, stage, foundationRefreshing, foundationRefreshFailed }: StepProps) {
  const ordered = orderTimeline(standard?.communications ?? []);
  return (
    <div>
      <StepHeading step="how" why="This is the plan the system will work to. It explains what will be planned, not what has been executed." />
      <dl className="grid gap-3 sm:grid-cols-2">
        <ReadOnlyFact label="Template" value={standard ? standard.templateName : 'Loading…'} note={standard?.templateSummary} />
        <ReadOnlyFact label="Recruitment cadence" value={`${ordered.filter(isRecruitmentTouch).length} recruitment touches`} note={ordered.filter(isRecruitmentTouch).map(describeTiming).join(' · ') || 'None'} />
        <ReadOnlyFact label="Reminders" value={ordered.filter((c) => /reminder/.test(c.key)).map((c) => `${c.name} (${describeTiming(c)})`).join(' · ') || 'None in this template'} />
        <ReadOnlyFact label="Follow-up obligations" value={ordered.filter((c) => /followup/.test(c.key)).length + ' planned follow-ups'} note="Follow-up workflow arrives in the next authorized phase." />
        <ReadOnlyFact label="Registration and suppression" value={session.registrationRule.suppressRecruitmentAfterRegistration ? 'Registrants suppressed (required, read-only)' : 'Legacy config: suppression disabled — required by the standard'} />
        <ReadOnlyFact label="Evidence" value={summary ? `${summary.evidence.records} record(s), all unverified` : 'Loading…'} />
        <ReadOnlyFact label="Governance" value={<StatusChip label="Review required" />} note="Exception review needs a trusted reviewer, which is unavailable." />
        <ReadOnlyFact label="Simulation readiness · Ready to recruit (engine, non-operational)" value={stage ? stage.status : 'Not evaluated'} />
      </dl>
      <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold">Foundation observations <ExplainTerm term="Governed observation" explanation="An output the Foundation provides so names, codes and links follow one governed standard. Only taxonomy can be simulated here." /></h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="foundation-grid">
        {(['taxonomy', 'internal_title', 'campaign_code', 'utm', 'objective_membership', 'campaign_exclusion'] as const).map((t) => (
          <CapabilityStatus key={t} type={t} output={out(summary, t)} compact refreshing={t === 'taxonomy' && foundationRefreshing} refreshFailed={t === 'taxonomy' && foundationRefreshFailed} />
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">No live Foundation connection exists. Environment: {summary?.foundation.environment ?? 'unknown'}.</p>
    </div>
  );
}

export function ReviewStep({ summary, stage, goTo, openRecruitment, dirtySteps }: StepProps & { dirtySteps: SetupStepId[] }) {
  const group = (title: string, tone: StatusLabel, items: { key: string; text: string; step: SetupStepId | 'recruitment'; detail?: string }[], testId: string) => (
    <section aria-labelledby={`ww-rv-${testId}`} className="ww-panel p-3" data-testid={`review-${testId}`}>
      <h3 id={`ww-rv-${testId}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold"><StatusChip label={tone} />{title} <span className="text-muted-foreground">({items.length})</span></h3>
      {items.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">None.</p> : (
        <ul className="mt-2 space-y-1 text-sm">{items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-start justify-between gap-2 border-b border-border py-1 last:border-0">
            <span className="min-w-0"><span className="block">{i.text}</span>{i.detail && <span className="block text-xs text-muted-foreground">{i.detail}</span>}</span>
            <button type="button" className="ww-link-btn text-xs" onClick={() => (i.step === 'recruitment' ? openRecruitment?.() : goTo(i.step as SetupStepId))}>Go to {i.step === 'recruitment' ? 'Recruitment' : SETUP_STEPS.find((s) => s.id === i.step)?.label}</button>
          </li>
        ))}</ul>
      )}
    </section>
  );
  const f = (x: WebinarApiFinding, detail?: string) => ({ key: `${x.ruleId}-${x.participantId ?? ''}`, text: `${x.rule.ruleName} (${x.ruleId})`, step: findingRoute(x), detail: detail ?? x.rule.resolutionGuidance });
  const unavailable = (summary?.foundation.outputs ?? []).filter((o) => o.status !== 'available-synthetic').map((o) => ({ key: o.type, text: `${o.type.replace(/_/g, ' ')}: ${o.status.replace(/_/g, ' ')}`, step: stepForField(o.type) }));
  return (
    <div>
      <StepHeading step="review" why="A single place to see what is complete and what still needs work before recruitment, grouped by severity." />
      {!stage && <p className="mb-3 text-sm" data-testid="review-not-evaluated">No evaluation yet. Run a simulation evaluation to populate findings.</p>}
      <div className="grid gap-3">
        {group('Blocking issues', 'Blocked', (stage?.unresolvedBlockingFailures ?? []).map((x) => f(x)), 'blocking')}
        {group('Warnings', 'Needs attention', [...(stage?.warnings ?? []), ...(stage?.nonblockingFailures ?? [])].map((x) => f(x)), 'warnings')}
        {group('Missing evidence and inputs', 'Incomplete', [
          ...(stage?.unassessedBlockers ?? []).map((x) => f(x, 'Evidence unavailable — not assessed')),
          ...(stage?.missingInputs ?? []).map((m) => ({ key: `mi-${m.field}`, text: m.field, step: stepForField(m.field), detail: m.reason })),
          ...(stage?.missingEvaluatorCoverage ?? []).map((r) => ({ key: `cov-${r}`, text: `${r}: evaluator coverage missing`, step: 'how' as SetupStepId, detail: 'Counts as incomplete, never as passed.' })),
        ], 'missing')}
        {group('Recommended improvements', 'Review required', (stage?.unassessedAdvisories ?? []).map((x) => f(x)), 'recommended')}
        {group('Resolved by exception (original failure kept)', 'Review required', (stage?.resolvedBlockingFailures ?? []).map((r) => ({ key: `rb-${r.ruleId}`, text: `${r.originalFailure.rule.ruleName} (${r.ruleId})`, step: findingRoute(r.originalFailure), detail: `Original failure: ${r.originalFailure.rule.failureMessage}` })), 'resolved')}
        {group('Unavailable governed capabilities', 'Unavailable', unavailable, 'unavailable')}
        {group('Stale results', 'Stale', [
          ...(stage?.staleness === 'stale' ? [{ key: 'stale', text: 'The last evaluation is older than the current inputs.', step: 'how' as SetupStepId }] : []),
          ...dirtySteps.map((s) => ({ key: `dirty-${s}`, text: `Unsaved changes in ${SETUP_STEPS.find((x) => x.id === s)?.label}`, step: s })),
        ], 'stale')}
        {group('Complete', 'Complete', (stage?.passedRules ?? []).map((x) => f(x, x.rule.expectedBehavior)), 'complete')}
      </div>
    </div>
  );
}

export function SaveBar({ dirty, saving, onSave, onBack, onNext, canBack, canNext, lastSaved, label }: {
  dirty: boolean; saving: boolean; onSave?: () => void; onBack: () => void; onNext: () => void; canBack: boolean; canNext: boolean; lastSaved: string | null; label: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-6 flex flex-col gap-2 border-t border-border bg-card/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm" aria-live="polite" data-testid="text-save-state">{saving ? 'Saving…' : dirty ? <span className="font-semibold">Unsaved changes</span> : lastSaved ? `All changes saved · ${lastSaved}` : 'No changes'}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="ww-target" onClick={onBack} disabled={!canBack}>Back</Button>
        {onSave && <Button type="button" variant="outline" className="ww-target" onClick={onSave} disabled={!dirty || saving} data-testid="button-save"><Save aria-hidden="true" className="mr-1 h-4 w-4" />{saving ? 'Saving…' : 'Save'}</Button>}
        <Button type="button" className="ww-target" onClick={onNext} disabled={!canNext || saving} data-testid="button-continue">{label}</Button>
      </div>
    </div>
  );
}

export { RegionError };
