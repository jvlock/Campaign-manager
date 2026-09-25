import { useMemo, useState } from 'react';
import { Mail, Link2, Users, ChevronDown, CalendarDays, Clock, AlertTriangle, Ban } from 'lucide-react';
import type { WebinarStandard, WebinarApiReadinessStage, WebinarApiFinding, WebinarApiSummary, WebinarSession } from '@workspace/api-client-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { StatusChip, ExplainTerm, SimulationBadge } from './status';
import {
  orderTimeline, touchState, TOUCH_STATE_LABEL, describeTiming, formatInstant, overdueLabel, executionLabel,
  recruitmentCounts, stageLabel, findingsForKey, isRecruitmentTouch, type OverdueAuthority,
} from '@/lib/webinar-workspace/adapters';

type Comm = WebinarStandard['communications'][number];

function touchShade(index: number) { return `ww-touch-${Math.min(index + 1, 5)}`; }

export type OverdueSource = { status: 'loading' } | { status: 'unavailable'; reason: string } | { status: 'ready'; auth: OverdueAuthority };

export function CommunicationCard({ c, index, timezone, overdue, findings, suppressionOn, onExpand }: {
  c: Comm; index: number; timezone: string; overdue: OverdueAuthority | null; findings: WebinarApiFinding[]; suppressionOn: boolean; onExpand?: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const state = touchState(c);
  const overdueText = overdueLabel(c.key, overdue);
  const at = c.scheduled.effectiveAt ?? c.scheduled.currentAt;
  const destOk = c.ctas.length > 0 && c.ctas.every((x) => x.destinationUrl && !x.destinationError);
  const contentOk = c.variants.some((v) => v.validation.valid);
  const shortened = overdue?.byKey[c.key]?.shortenedWindow === true;
  const primary = findings[0]?.rule.failureMessage ?? (!destOk ? 'Destination missing' : !contentOk ? 'Content incomplete' : null);
  const recruitment = isRecruitmentTouch(c);
  return (
    <Collapsible open={open} onOpenChange={(o) => { setOpen(o); if (o) onExpand?.(c.key); }} asChild>
      <li className={`ww-panel ww-touch-rail ${touchShade(index)} overflow-hidden`} data-testid={`touch-${c.key}`} data-state-label={state}>
        <CollapsibleTrigger className="ww-target flex w-full flex-col gap-2 p-3 text-left sm:flex-row sm:items-center" aria-label={`${c.name}, ${TOUCH_STATE_LABEL[state]}, ${overdueText}, ${executionLabel()}. Show details`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Mail aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="font-semibold">{c.name}</span>
              <StatusChip label={TOUCH_STATE_LABEL[state]} testId={`touch-status-${c.key}`} />
              <StatusChip label={overdueText} testId={`touch-overdue-${c.key}`} />
              <StatusChip label={executionLabel()} testId={`touch-execution-${c.key}`} />
              {shortened && <StatusChip label="Shortened window" tone="attention" />}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Clock aria-hidden="true" className="h-3 w-3" />{describeTiming(c)}</span>
              <span className="inline-flex items-center gap-1"><CalendarDays aria-hidden="true" className="h-3 w-3" />{formatInstant(at, timezone)}</span>
              <span className="inline-flex items-center gap-1"><Link2 aria-hidden="true" className="h-3 w-3" />Destination {destOk ? 'set (planned, not verified)' : 'missing'}</span>
              <span>CTA {c.ctas.length ? c.ctas.map((x) => x.status).join(', ') : 'none'}</span>
              {recruitment && <span className="inline-flex items-center gap-1"><Users aria-hidden="true" className="h-3 w-3" />{suppressionOn ? 'Registrants suppressed' : 'Suppression disabled (legacy config)'}</span>}
            </p>
            {primary && <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium"><AlertTriangle aria-hidden="true" className="h-3 w-3" />{primary}</p>}
          </div>
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border bg-muted/20 p-3 text-sm">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Subject / content reference</dt><dd>{c.variants.map((v) => v.content.subject || v.content.internalAssetName).filter(Boolean).join(' · ') || 'No content reference yet'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Audience rule</dt><dd>{c.audienceRule}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Scheduled instant (engine)</dt><dd>{at ? `${formatInstant(at, timezone)} · ${at}` : 'Not scheduled'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Original instant</dt><dd>{formatInstant(c.scheduled.originalAt, timezone)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Overdue (backend preview)</dt><dd>{overdue?.byKey[c.key] ? `${overdueText} as of ${formatInstant(overdue.calculatedAt, timezone)}` : 'Unknown — no authoritative status'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Execution</dt><dd>Unknown — the API provides no execution evidence or actual send time</dd></div>
            <div><dt className="text-xs text-muted-foreground">Engine status</dt><dd>{c.scheduled.status} · {c.status}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Suppression / skip reason</dt><dd data-testid={`touch-reason-${c.key}`}>{c.scheduled.skipReason ?? (state === 'suppressed' ? 'Suppressed by the engine (no reason recorded)' : 'None')}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Destinations</dt><dd>
              {c.ctas.length === 0 ? 'No CTA destination linked' : (
                <ul>{c.ctas.map((x) => <li key={x.id} className="break-all">{x.name}: {x.destinationUrl ?? 'no URL'}{x.destinationError ? ` — ${x.destinationError}` : ''} ({x.status})</li>)}</ul>
              )}
            </dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Rule findings</dt><dd>
              {findings.length === 0 ? 'No findings reference this touch in the last evaluation.' : (
                <ul className="space-y-1">{findings.map((f) => <li key={f.ruleId}><span className="font-mono text-xs">{f.ruleId}</span> {f.rule.ruleName} — {f.status.replace(/_/g, ' ')}</li>)}</ul>
              )}
            </dd></div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Edit content and CTAs from the activity’s communication editor on the campaign map. There is no send action: nothing is delivered externally.</p>
        </CollapsibleContent>
      </li>
    </Collapsible>
  );
}

export function RecruitmentView({ standard, session, stage, summary, overdueSource, onExpand, onJumpSetup }: {
  standard: WebinarStandard; session: WebinarSession; stage: WebinarApiReadinessStage | undefined; summary: WebinarApiSummary | undefined;
  overdueSource: OverdueSource; onExpand?: (key: string) => void; onJumpSetup: (step: 'who' | 'when') => void;
}) {
  const ordered = useMemo(() => orderTimeline(standard.communications), [standard.communications]);
  const auth = overdueSource.status === 'ready' ? overdueSource.auth : null;
  const future = ordered;
  const counts = recruitmentCounts(ordered.filter(isRecruitmentTouch), auth);
  const allFindings = useMemo(() => [
    ...(stage?.failedBlockers ?? []), ...(stage?.warnings ?? []), ...(stage?.failedNonBlocking ?? []),
  ], [stage]);
  const suppressionOn = session.registrationRule.suppressRecruitmentAfterRegistration;
  const eventAt = `${session.sessionDate} ${session.startTime} (${session.timezone})`;
  const reg = summary?.registrationSummary;
  const before = future.filter((c) => c.timing.direction === 'before' || c.timing.kind === 'trigger');
  const after = future.filter((c) => c.timing.direction === 'after');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <section aria-labelledby="ww-supp-h" className="ww-panel p-4" data-testid="panel-suppression">
          <div className="flex flex-wrap items-center gap-2"><Ban aria-hidden="true" className="h-4 w-4" /><h3 id="ww-supp-h" className="font-semibold">Registration suppression</h3><SimulationBadge /></div>
          <p className="mt-1 text-sm" data-testid="text-suppression-rule">{suppressionOn ? 'Required by the standard: registered participants are removed from future recruitment. Read-only here.' : 'Warning: this webinar carries a legacy configuration with registration suppression disabled. The standard requires suppression; this workspace cannot change it and offers no bypass. Expect a blocking finding.'}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            <li>Suppressed communications stay visible with their reason.</li>
            <li>Cancelling a registration does not silently restore recruitment eligibility.</li>
            <li>Internal and test records remain excluded.</li>
            <li>Governed exclusions cannot be bypassed — Foundation exclusions are currently unavailable.</li>
          </ul>
          <p className="mt-2 text-xs" data-testid="text-population">
            {reg && reg.status === 'synthetic-recorded' ? `Synthetic population summary: ${reg.registered} registered · ${reg.cancelled} cancelled · ${reg.waitlisted} waitlisted · ${reg.notRegistered} not registered. No individual customer records are shown.` : 'No synthetic registrations recorded.'}
            {summary ? ` Recorded suppression obligations: ${summary.suppression.recordedObligations} (not operational).` : ''}
          </p>
        </section>

        <section aria-labelledby="ww-tl-h">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 id="ww-tl-h" className="font-semibold">Communication sequence</h3>
            <ExplainTerm term="Cadence" explanation="Timing comes from the scheduling engine, including shortened-window adjustments. The workspace does not calculate or move touches." />
          </div>
          <ol className="space-y-2" aria-label="Communications before the webinar, in scheduled order" data-testid="list-timeline">
            {before.map((c, i) => <CommunicationCard key={c.id} c={c} index={i} timezone={session.timezone} overdue={auth} findings={findingsForKey(allFindings, c.key, c.id)} suppressionOn={suppressionOn} onExpand={onExpand} />)}
            <li className="ww-anchor flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold" data-testid="timeline-anchor">
              <CalendarDays aria-hidden="true" className="h-4 w-4" /> Webinar · {eventAt}
            </li>
            {after.map((c, i) => <CommunicationCard key={c.id} c={c} index={i} timezone={session.timezone} overdue={auth} findings={findingsForKey(allFindings, c.key, c.id)} suppressionOn={suppressionOn} onExpand={onExpand} />)}
          </ol>
          <button type="button" className="ww-link-btn mt-2 text-sm" onClick={() => onJumpSetup('when')}>Change the webinar date in Setup · When</button>
        </section>

        <section aria-labelledby="ww-exec-h">
          <h3 id="ww-exec-h" className="font-semibold">Execution history</h3>
          <p className="text-sm text-muted-foreground" data-testid="text-no-history">Unknown. The API provides no execution evidence or actual send timestamps, so no history is shown and no touch is presented as sent.</p>
        </section>
      </div>

      <aside aria-labelledby="ww-rs-h" className="ww-panel h-fit p-4 lg:sticky lg:top-4" data-testid="panel-recruitment-status">
        <h3 id="ww-rs-h" className="font-semibold">Recruitment status</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm">Simulation readiness (non-operational) · Ready to recruit:</span>
          <StatusChip label={stageLabel(stage)} testId="status-ready-to-recruit" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Determined by the engine, not this screen.{stage && !stage.fullyEvaluated ? ' Evaluator coverage is incomplete for this stage.' : ''}</p>
        <p className="mt-2 text-xs" data-testid="text-overdue-source">{overdueSource.status === 'ready' ? `Overdue as of ${formatInstant(overdueSource.auth.calculatedAt, session.timezone)} (backend preview).` : overdueSource.status === 'loading' ? 'Loading overdue status from the backend…' : `Overdue status unknown: ${overdueSource.reason}`}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          {([
            ['Planned', counts.planned], ['Plans with content and destination (informational)', counts.withContentAndDestination], ['Missing destination', counts.missingDestination],
            ['Missing content', counts.missingContent], ['Suppressed', counts.suppressed], ['Overdue', counts.overdue ?? 'Unknown'],
            ['Blocking findings', stage?.unresolvedBlockingFailures.length ?? 0], ['Warnings', (stage?.warnings.length ?? 0) + (stage?.nonblockingFailures.length ?? 0)],
            ['Missing evidence', stage?.unassessedBlockers.length ?? 0],
          ] as const).map(([k, v]) => <div key={k} className="rounded-md bg-muted/40 p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Last calculation: {stage ? formatInstant(stage.calculationAt, session.timezone) : 'never'} · {stage ? (stage.staleness === 'current' ? 'Current' : stage.staleness === 'stale' ? 'Stale' : 'Not evaluated') : 'Not evaluated'}</p>
      </aside>
    </div>
  );
}
