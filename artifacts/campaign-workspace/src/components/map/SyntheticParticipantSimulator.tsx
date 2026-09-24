import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useCreateSyntheticParticipantFixture, useGetSyntheticParticipantContext, useGetSyntheticParticipantHistory,
  useInspectSyntheticParticipantSuppression, useListSyntheticParticipantFixtures,
  useListSyntheticParticipantPopulation, useTransitionSyntheticParticipant,
  type SyntheticCommunicationKind, type SyntheticFixtureInput, type SyntheticTransitionInput, type SyntheticTransitionResult,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Action = SyntheticTransitionInput['action'];
const actions: Action[] = ['register', 'waitlist', 'promote', 'cancel-registration', 'cancel-occurrence',
  'reschedule', 'complete-occurrence', 'record-attendance', 'reconcile-attendance'];
const communicationKinds: SyntheticCommunicationKind[] = ['recruitment_1', 'recruitment_2', 'recruitment_3',
  'final_recruitment', 'registration_confirmation', 'calendar_information', 'reminder_24_hour',
  'reminder_1_hour', 'attended_follow_up', 'absent_follow_up', 'neutral_follow_up',
  'attendance_reconciliation', 'event_cancellation_notice'];
const select = 'rounded border border-input bg-background px-2 py-1 text-sm';
function reason(action: Action, event: string, registration: string, attendance: string): string | null {
  if (event === 'cancelled') return 'The occurrence was cancelled; no further lifecycle transitions are permitted.';
  switch (action) {
    case 'register': return !['open_for_registration', 'scheduled'].includes(event) || !['not_registered', 'cancelled'].includes(registration)
      ? 'Requires an open occurrence and a new or explicitly cancelled registration.' : null;
    case 'waitlist': return !['open_for_registration', 'scheduled'].includes(event) || registration !== 'not_registered'
      ? 'Requires an unregistered participant and open occurrence.' : null;
    case 'promote': return !['open_for_registration', 'scheduled'].includes(event) || registration !== 'waitlisted'
      ? 'Only an explicitly waitlisted participant can be promoted on an open occurrence.' : null;
    case 'cancel-registration': return registration !== 'registered' || attendance !== 'unknown'
      || !['open_for_registration', 'scheduled'].includes(event)
      ? 'Requires a registered participant in an upcoming occurrence without an attendance classification.' : null;
    case 'record-attendance': return event !== 'completed' || registration !== 'registered'
      ? 'Requires completed occurrence and confirmed registration; an email action cannot establish attendance.' : null;
    case 'reconcile-attendance': return event !== 'completed' || registration !== 'registered'
      ? 'Requires a completed occurrence and confirmed registration; a prior source observation is also required.' : null;
    case 'complete-occurrence': return !['scheduled', 'in_progress'].includes(event)
      ? 'Only a scheduled or in-progress occurrence can complete, with a real synthetic actual-end observation.' : null;
    case 'cancel-occurrence': return event === 'completed' ? 'A completed occurrence cannot be cancelled.' : null;
    case 'reschedule': return !['draft', 'open_for_registration', 'scheduled'].includes(event)
      ? 'Only an upcoming occurrence can be rescheduled.' : null;
  }
}
function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as { error?: string | { message?: string } };
    if (typeof data?.error === 'string') return data.error;
    if (data?.error?.message) return data.error.message;
  }
  return error instanceof Error ? error.message : 'Synthetic simulation request failed.';
}
interface Props { campaignId: string; activityId: string; sessionId: string }
export function SyntheticParticipantSimulator({ campaignId, activityId, sessionId }: Props) {
  const client = useQueryClient();
  const scope = { campaignId, activityId, sessionId };
  const [branchFilter, setBranchFilter] = useState('');
  const [fixtureCursors, setFixtureCursors] = useState<string[]>([]);
  const [populationCursors, setPopulationCursors] = useState<string[]>([]);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [fixtureNumber, setFixtureNumber] = useState(1);
  const [branch, setBranch] = useState('');
  const [audienceClass, setAudienceClass] = useState<'customer' | 'internal' | 'test'>('customer');
  const [personId, setPersonId] = useState('');
  const [action, setAction] = useState<Action>('register');
  const [attendance, setAttendance] = useState<'attended' | 'absent'>('attended');
  const [sessionDate, setSessionDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [timezone, setTimezone] = useState('');
  const [kind, setKind] = useState<SyntheticCommunicationKind>('recruitment_1');
  const [draft, setDraft] = useState<SyntheticTransitionInput | null>(null);
  const [fixtureDraft, setFixtureDraft] = useState<SyntheticFixtureInput | null>(null);
  const [result, setResult] = useState<SyntheticTransitionResult | null>(null);
  const [localError, setLocalError] = useState('');
  const context = useGetSyntheticParticipantContext(scope);
  const fixtures = useListSyntheticParticipantFixtures({ ...scope, limit: 25, offset: 0,
    ...(fixtureCursors.length ? { after: fixtureCursors[fixtureCursors.length - 1] } : {}),
    ...(branchFilter ? { audienceBranchId: branchFilter } : {}),
  }, { query: {
    queryKey: ['synthetic-fixtures', campaignId, activityId, sessionId, branchFilter, fixtureCursors.at(-1) ?? ''],
    enabled: !!context.data,
  } });
  const population = useListSyntheticParticipantPopulation({ ...scope, limit: 25, offset: 0,
    ...(populationCursors.length ? { after: populationCursors[populationCursors.length - 1] } : {}),
    ...(branchFilter ? { audienceBranchId: branchFilter } : {}),
  }, { query: {
    queryKey: ['synthetic-population', campaignId, activityId, sessionId, branchFilter, populationCursors.at(-1) ?? ''],
    enabled: !!context.data,
  } });
  const history = useGetSyntheticParticipantHistory({ ...scope, personId, limit: 25, offset: historyOffset,
    ...(branchFilter ? { audienceBranchId: branchFilter } : {}),
  }, { query: {
    queryKey: ['synthetic-history', campaignId, activityId, sessionId, branchFilter, personId, historyOffset],
    enabled: !!context.data && !!personId,
  } });
  const inspect = useInspectSyntheticParticipantSuppression({
    ...scope, personId, kind, calculationAt: new Date().toISOString(),
    ...(branchFilter ? { audienceBranchId: branchFilter } : {}),
  }, { query: { queryKey: ['synthetic-suppression', campaignId, activityId, sessionId, branchFilter, personId, kind], enabled: false } });
  const create = useCreateSyntheticParticipantFixture();
  const transition = useTransitionSyntheticParticipant();
  useEffect(() => {
    setFixtureCursors([]); setPopulationCursors([]); setHistoryOffset(0);
    setBranchFilter(''); setPersonId(''); setDraft(null); setFixtureDraft(null); setResult(null); setLocalError('');
  }, [campaignId, activityId, sessionId]);
  const selected = fixtures.data?.fixtures.find(row => row.personId === personId);
  const state = population.data?.participants.find(row => row.participantId === personId);
  const requiresPerson = !['cancel-occurrence', 'reschedule', 'complete-occurrence'].includes(action);
  const prohibited = reason(action, context.data?.eventStatus ?? '', selected?.registrationStatus ?? 'not_registered',
    selected?.attendanceStatus ?? 'unknown') ?? (action === 'reconcile-attendance' && history.data && history.data.total <= 25
      && !history.data.events.some(event => event.action === 'record-attendance')
      ? 'Reconciliation requires an existing synthetic attendance source observation.' : null);
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['synthetic-fixtures'] }),
      client.invalidateQueries({ queryKey: ['synthetic-population'] }),
      client.invalidateQueries({ queryKey: ['synthetic-history'] }),
    ]);
    await Promise.all([context.refetch(), fixtures.refetch(), population.refetch(), ...(personId ? [history.refetch()] : [])]);
  };
  const submit = async (request: SyntheticTransitionInput) => {
    setLocalError('');
    try {
      const response = await transition.mutateAsync({ data: request });
      setResult(response); setDraft(null);
      await refresh();
    } catch (error) { setLocalError(`${errorMessage(error)} Draft and fixed retry tuple retained. Reload source revision only when starting a new action.`); }
  };
  const submitFixture = async (request: SyntheticFixtureInput) => {
    setLocalError('');
    try {
      await create.mutateAsync({ data: request }); setFixtureDraft(null);
      await refresh();
    } catch (error) { setLocalError(`${errorMessage(error)} Fixture and fixed retry tuple retained.`); }
  };
  const start = () => {
    if (!context.data || (requiresPerson && !personId) || prohibited) return;
    const request: SyntheticTransitionInput = {
      ...scope, action, expectedRevision: context.data.revision, idempotencyKey: crypto.randomUUID(),
      sourceReference: crypto.randomUUID(), calculationAt: new Date().toISOString(),
      ...(requiresPerson ? { personId } : {}),
      ...(requiresPerson && branchFilter ? { audienceBranchId: branchFilter } : {}),
      ...(['record-attendance', 'reconcile-attendance'].includes(action) ? { attendance } : {}),
      ...(action === 'reschedule' ? { sessionDate, startTime, timezone } : {}),
      ...(action === 'complete-occurrence' ? { actualEndAt: new Date().toISOString() } : {}),
    };
    setDraft(request); void submit(request);
  };
  return <Card>
    <CardHeader><CardTitle>Synthetic participant simulator — no customer data</CardTitle></CardHeader>
    <CardContent className="space-y-4 text-sm">
      <p className="text-muted-foreground">Open-development, unverified simulation-only source observations and obligations. A branch filter scopes this view; it does not authenticate a group or grant authority. No delivery, provider handoff, approval or customer records. Existing webinar preview remains separate.</p>
      {context.isPending ? <p>Checking exact-standard synthetic occurrence…</p> : context.error
        ? <p role="alert" className="text-destructive">{errorMessage(context.error)}</p>
        : context.data && <>
          <p>Event: <strong>{context.data.eventStatus}</strong> · {context.data.sessionDate} {context.data.startTime} ({context.data.timezone}) · revision {context.data.revision}</p>
          <label className="block">Audience branch view <select className={`${select} ml-2 max-w-full`} value={branchFilter}
            onChange={e => { setBranchFilter(e.target.value); if (e.target.value) setBranch(e.target.value);
              setFixtureCursors([]); setPopulationCursors([]);
              setHistoryOffset(0); setPersonId(''); setDraft(null); setResult(null); }}>
            <option value="">All synthetic branches</option>
            {context.data.audienceBranchIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select></label>
          <div className="rounded border p-3 space-y-2">
            <strong>Create deterministic synthetic fixture</strong>
            <p className="text-xs text-muted-foreground">Reserved participants.test address; no names, email entry, CRM identifiers, import or bulk upload.</p>
            <label>Fixture number <input className={select} type="number" min={1} max={99999999} value={fixtureNumber}
              onChange={e => setFixtureNumber(Number(e.target.value))} /></label>{' '}
            <label>Audience branch <select className={select} value={branch} onChange={e => setBranch(e.target.value)}>
              <option value="">Choose branch</option>{context.data.audienceBranchIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select></label>{' '}
            <label>Class <select className={select} value={audienceClass} onChange={e => setAudienceClass(e.target.value as typeof audienceClass)}>
              <option value="customer">Synthetic customer-class</option><option value="internal">Internal exclusion</option><option value="test">Test exclusion</option>
            </select></label>{' '}
            <Button variant="outline" disabled={create.isPending || !branch || !Number.isInteger(fixtureNumber) || fixtureNumber < 1 || fixtureNumber > 99999999}
              onClick={() => {
                const request: SyntheticFixtureInput = { ...scope, fixtureKey: `fixture-${fixtureNumber}`, audienceBranchId: branch,
                  audienceClass, expectedRevision: context.data!.revision, calculationAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
                setFixtureDraft(request); void submitFixture(request);
              }}>Create fixture</Button>
            {fixtureDraft && <><p className="break-all text-xs">Fixture retry: {fixtureDraft.fixtureKey} · {fixtureDraft.calculationAt} · revision {fixtureDraft.expectedRevision} · key {fixtureDraft.idempotencyKey}</p>
              <Button variant="outline" disabled={create.isPending} onClick={() => void submitFixture(fixtureDraft)}>Retry identical fixture</Button></>}
          </div>
          <div className="rounded border p-3 space-y-2">
            <strong>Scoped synthetic fixtures ({fixtures.data?.total ?? 0} in campaign; {population.data?.total ?? 0} enrolled in occurrence)</strong>
            <label className="block">Participant on fixture page {fixtureCursors.length + 1} <select className={`${select} ml-2 max-w-full`} value={personId} onChange={e => { setPersonId(e.target.value); setHistoryOffset(0); setDraft(null); }}>
              <option value="">Choose synthetic fixture</option>{fixtures.data?.fixtures.map(row => <option value={row.personId} key={row.personId}>{row.fixtureKey} · {row.audienceClass} · {row.registrationStatus} · {row.attendanceStatus}</option>)}
            </select></label>
            {selected && <p>Registration: {selected.registrationStatus} · Attendance: {selected.attendanceStatus} · Source: {selected.fixtureKey} ({selected.syntheticEmail}). {state ? `Canonical state: ${state.state}.` : 'Not present on the current population page; page through the population to inspect its canonical state.'}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={!fixtureCursors.length} onClick={() => { setFixtureCursors(value => value.slice(0, -1)); setPersonId(''); }}>Previous fixtures</Button>
              <Button variant="outline" disabled={!fixtures.data?.nextCursor || fixtures.isFetching} onClick={() => {
                if (fixtures.data?.nextCursor) { setFixtureCursors(value => [...value, fixtures.data!.nextCursor!]); setPersonId(''); }
              }}>Next fixtures</Button>
              <span>Fixture page {fixtureCursors.length + 1}: {fixtures.data?.returned ?? 0} shown / {fixtures.data?.total ?? 0} total.
                {fixtures.data?.nextCursor ? ' Partial population; next page available.' : fixtureCursors.length ? ' Last page; previous pages not displayed.' : ' Complete fixture page.'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={!populationCursors.length} onClick={() => setPopulationCursors(value => value.slice(0, -1))}>Previous enrolled</Button>
              <Button variant="outline" disabled={!population.data?.nextCursor || population.isFetching} onClick={() => {
                if (population.data?.nextCursor) setPopulationCursors(value => [...value, population.data!.nextCursor!]);
              }}>Next enrolled</Button>
              <span>Enrolled page {populationCursors.length + 1}: {population.data?.returned ?? 0} shown / {population.data?.total ?? 0} total.
                {population.data?.nextCursor ? ' Partial population; next page available.' : populationCursors.length ? ' Last page; previous pages not displayed.' : ' Complete enrolled page.'}</span>
            </div>
            <details><summary>Canonical states on current enrolled page ({population.data?.returned ?? 0})</summary>
              {population.data?.participants.map(participant => <div className="border-t py-1" key={participant.participantId}>
                <span className="break-all">{participant.participantId}</span> · {participant.state} · {participant.obligations.length} planned obligations
                · suppression: {participant.suppressions.join(', ') || 'no canonical state exclusion (governed observation unavailable)'}
              </div>)}
            </details>
            {state && <details><summary>Current canonical communication obligations and follow-up variants</summary>
              {state.obligations.map(o => <p key={o.communicationId}>{o.kind} · {o.disposition} · {o.variant ?? 'no variant'} · {o.reason}</p>)}
              <p>Suppressions: {state.suppressions.join(', ') || 'none in canonical plan (governed exclusion observation still unavailable)'}</p>
            </details>}
            {personId && <details><summary>Immutable source history ({history.data?.total ?? 0}; page {Math.floor(historyOffset / 25) + 1})</summary>
              {history.data?.events.map(event => <div className="border-t py-1" key={event.id}>
                {event.action} · {event.observedAt} · source {event.sourceReference} · {event.snapshotIds.length} snapshot(s)
                <pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ fact: event.payload, obligationChanges: event.obligations }, null, 2)}</pre>
              </div>)}
              <Button variant="outline" disabled={!historyOffset} onClick={() => setHistoryOffset(value => Math.max(0, value - 25))}>Previous history</Button>{' '}
              <Button variant="outline" disabled={!history.data || historyOffset + history.data.events.length >= history.data.total}
                onClick={() => setHistoryOffset(value => value + 25)}>Next history</Button>
              {history.error && <p role="alert">{errorMessage(history.error)}</p>}
            </details>}
          </div>
          <div className="rounded border p-3 space-y-2">
            <strong>Transition source fact</strong>
            <label className="block">Action <select className={`${select} ml-2`} value={action} onChange={e => { setAction(e.target.value as Action); setDraft(null); }}>
              {actions.map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            {['record-attendance', 'reconcile-attendance'].includes(action) && <label>Source classification <select className={`${select} ml-2`} value={attendance} onChange={e => setAttendance(e.target.value as typeof attendance)}>
              <option value="attended">Attended</option><option value="absent">Explicit absent</option>
            </select></label>}
            {['record-attendance', 'reconcile-attendance'].includes(action) && <p className="text-xs text-muted-foreground">Leave attendance unknown by recording no observation. Missing source data is not explicit absence.</p>}
            {action === 'reschedule' && <div className="flex flex-wrap gap-2">
              <label>Local date <input className={select} type="date" value={sessionDate} onChange={e => setSessionDate(e.target.value)} /></label>
              <label>Local time <input className={select} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} /></label>
              <label>IANA zone <select className={select} value={timezone} onChange={e => setTimezone(e.target.value)}>
                <option value="">Choose zone</option>{[context.data.timezone, 'UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London'].filter((v, i, all) => all.indexOf(v) === i).map(zone => <option key={zone}>{zone}</option>)}
              </select></label>
            </div>}
            {prohibited && <p role="status" className="text-amber-700">Prohibited: {prohibited}</p>}
            {!requiresPerson && <p>Occurrence action affects all enrolled synthetic participants; it is not participant cancellation.</p>}
            <Button disabled={transition.isPending || !!prohibited || (requiresPerson && !personId)
              || (action === 'reschedule' && !(sessionDate && startTime && timezone))}
              onClick={start}>Record source and simulate</Button>
            {draft && <><p className="break-all text-xs">Fixed retry: {draft.calculationAt} · revision {draft.expectedRevision} · key {draft.idempotencyKey} · source {draft.sourceReference}</p>
              <Button variant="outline" disabled={transition.isPending} onClick={() => void submit(draft)}>Retry identical source event</Button>
              <Button variant="outline" onClick={() => { setDraft(null); void refresh(); }}>Reload source revision for new action</Button></>}
          </div>
          {personId && <div className="rounded border p-3 space-y-2"><strong>Inspect fail-closed suppression</strong>{' '}
            <select className={select} value={kind} onChange={e => setKind(e.target.value as SyntheticCommunicationKind)}>
              {communicationKinds.map(value => <option key={value}>{value}</option>)}
            </select>{' '}
            <Button variant="outline" onClick={() => void inspect.refetch()}>Inspect decision</Button>
            {inspect.data && <p>{inspect.data.communicationId ?? 'No configured communication identity'}: {inspect.data.reasonCode} — {inspect.data.explanation} · {inspect.data.operationalStatus}</p>}
            {inspect.error && <p role="alert">{errorMessage(inspect.error)}</p>}
          </div>}
          {result && <div className="rounded border border-amber-300 bg-amber-50 p-3 space-y-2" role="status">
            <strong>Immutable simulation snapshot · {result.replayed ? 'replayed' : 'new'}</strong>
            <p className="break-all">Event {result.eventId} · snapshots {result.snapshotIds.join(', ')} · input fingerprint {result.snapshot.inputFingerprint}</p>
            <p>Operational status: {result.snapshot.operationalStatus}; never approval or delivery.</p>
            <details open><summary>Before / after communication obligations and states</summary>
              <div className="grid gap-2 md:grid-cols-2"><pre className="overflow-auto whitespace-pre-wrap text-xs">Before: {JSON.stringify(result.before, null, 2)}</pre>
                <pre className="overflow-auto whitespace-pre-wrap text-xs">After: {JSON.stringify(result.after, null, 2)}</pre></div>
            </details>
            <details><summary>Suppression decisions, blockers, warnings and unavailable Foundation observations</summary>
              <pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({
                suppression: result.suppression, blockers: result.snapshot.unresolvedBlockingFailures,
                warnings: result.snapshot.warnings, missingInputs: result.snapshot.missingInputData,
                unavailableFoundation: result.snapshot.unavailableExternalObservations,
              }, null, 2)}</pre>
            </details>
          </div>}
        </>}
      {(localError || fixtures.error || population.error) && <p role="alert" className="text-destructive">{localError || errorMessage(fixtures.error || population.error)}</p>}
    </CardContent>
  </Card>;
}