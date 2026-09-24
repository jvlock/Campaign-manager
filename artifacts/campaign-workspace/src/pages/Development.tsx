import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCampaign, useListCampaigns, useListWebinars, useGetDevelopmentSimulationContext, useGetDevelopmentGroups, useGetDevelopmentOwnership, useGetDevelopmentCalendar, useCreateDevelopmentGroup, useUpdateDevelopmentOwnership, useSimulateDevelopmentWorkflow } from '@workspace/api-client-react';
import { Link, useSearch } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ProvisionalBadge } from '@/components/governance/ProvisionalNotice';

interface Group { id: string; name: string; kind: string; parentId: string | null; accountableOwnerId: string | null }
interface Groups { groups: Group[]; profiles: { id: string; name: string }[] }
interface Entry { id: string; campaignId: string; groupId: string; title: string; date: string | null; timeZone: string | null; status: string; accountableOwnerId: string | null; dates?: { id: string; date: string | null; timeZone: string | null; status: string }[] }
interface Ownership { rowVersion: number; groupId?: string; accountableOwnerId?: string | null; group_id?: string; accountable_owner_id?: string | null; creatorId?: string | null }
interface CreateUnit { name: string; kind: string; parentId: string; accountableOwnerId: string }
interface SimulationResult {
  operationalStatus?: string; message?: string; activityId?: string; occurrenceId?: string;
  standard?: { id: string; version: string }; calculationAt?: string;
  releaseFingerprint?: string; inputFingerprint?: string; snapshotId?: string;
  unresolvedBlockingFailures?: unknown[]; blockersResolvedByExceptions?: unknown[];
  nonblockingFailures?: unknown[]; warnings?: unknown[]; missingInputData?: unknown[];
  unavailableExternalObservations?: unknown[]; mappingErrors?: unknown[];
  [key: string]: unknown;
}
interface SimulationTuple { calculationAt: string; idempotencyKey: string; expectedRevision: number; campaignId: string; activityId: string; occurrenceId: string }
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

function FindingList({ title, items }: { title: string; items?: unknown[] }) {
  return <section><strong>{title} ({items?.length ?? 0})</strong>{items?.length ? <ul className="list-disc pl-5">{items.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : null;
    const description = record ? [record.ruleId ?? record.field ?? record.code, record.message ?? record.reason ?? record.description].filter(part => typeof part === 'string').join(' · ') : null;
    return <li key={index}>{description || JSON.stringify(item)}</li>;
  })}</ul> : <p className="text-muted-foreground">None reported.</p>}</section>;
}

function planningError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as { error?: string | { message?: string }; currentRevision?: number | null; expectedRevision?: number };
    if (typeof data?.error === 'string') return `${data.error}${data.currentRevision != null ? ` Current revision: ${data.currentRevision}; request revision: ${data.expectedRevision}.` : ''}`;
    if (data?.error?.message) return data.error.message;
  }
  return error instanceof Error ? error.message : 'Unable to complete this planning request.';
}

export default function Development() {
  const search = useSearch();
  const calendarCampaignId = new URLSearchParams(search).get('campaignId') || '';
  const client = useQueryClient();
  const [groupFilter, setGroupFilter] = useState('');
  const [calendarCursor, setCalendarCursor] = useState<string | undefined>();
  useEffect(() => { setCalendarCursor(undefined); }, [calendarCampaignId]);
  const [campaignId, setCampaignId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [occurrenceId, setOccurrenceId] = useState('');
  const [simulationTuple, setSimulationTuple] = useState<SimulationTuple | null>(null);
  const [notice, setNotice] = useState('');
  const groups = useGetDevelopmentGroups(undefined, { query: { queryKey: ['development-groups'], select: data => data as unknown as Groups, refetchInterval: 30000 } });
  const campaigns = useListCampaigns();
  const campaign = useGetCampaign(campaignId, { query: { queryKey: ['/api/campaigns', campaignId], enabled: Boolean(campaignId) } });
  const webinars = useListWebinars(campaignId, { query: { queryKey: ['development-webinars', campaignId], enabled: Boolean(campaignId) } });
  const selectedActivity = campaign.data?.map.activities.find(a => a.id === activityId);
  const isWebinar = selectedActivity?.activityTypeId === 'webinar';
  const occurrences = webinars.data?.filter(session => session.activityId === activityId) ?? [];
  const simulationContext = useGetDevelopmentSimulationContext({ campaignId, activityId, occurrenceId }, {
    query: { queryKey: ['development-simulation-context', campaignId, activityId, occurrenceId],
      enabled: Boolean(campaignId && activityId && occurrenceId && isWebinar) },
  });
  const type = activityId ? 'activities' : 'campaigns';
  const recordId = activityId || campaignId;
  const ownership = useGetDevelopmentOwnership(type, recordId, { query: {
    queryKey: ['development-ownership', type, recordId],
    select: data => data as unknown as { ownership: Ownership },
    enabled: Boolean(recordId), refetchInterval: 30000,
  } });
  const calendar = useGetDevelopmentCalendar({ groupId: groupFilter || undefined, campaignId: calendarCampaignId || undefined, after: calendarCursor }, { query: {
    queryKey: ['development-calendar', groupFilter, calendarCampaignId, calendarCursor],
    select: data => data as unknown as { entries: Entry[]; total: number; returned: number; hasMore: boolean; nextCursor: string | null },
    refetchInterval: 30000,
  } });
  const calendarEntries = calendar.data?.entries;
  const createForm = useForm<CreateUnit>({ defaultValues: { name: '', kind: 'group', parentId: '', accountableOwnerId: '' } });
  const ownerForm = useForm({ values: {
    groupId: ownership.data?.ownership.groupId ?? ownership.data?.ownership.group_id ?? '',
    accountableOwnerId: ownership.data?.ownership.accountableOwnerId ?? ownership.data?.ownership.accountable_owner_id ?? '',
  } });
  const refresh = async () => { await client.invalidateQueries(); };
  const create = useCreateDevelopmentGroup({ mutation: {
    onSuccess: async () => { createForm.reset(); setNotice('Development organization unit created.'); await refresh(); },
  } });
  const update = useUpdateDevelopmentOwnership({ mutation: {
    onSuccess: async () => { setNotice('Planning ownership saved. Attribution remains unverified.'); await refresh(); },
  } });
  const simulate = useSimulateDevelopmentWorkflow();
  const runWebinarSimulation = (tuple: SimulationTuple) => simulate.mutate({ data: {
    campaignId: tuple.campaignId, activityId: tuple.activityId, occurrenceId: tuple.occurrenceId,
    calculationAt: tuple.calculationAt, idempotencyKey: tuple.idempotencyKey, expectedRevision: tuple.expectedRevision,
  } });
  const beginWebinarSimulation = (expectedRevision: number) => {
    const tuple = { campaignId, activityId, occurrenceId, expectedRevision,
      calculationAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID() };
    setSimulationTuple(tuple);
    simulate.reset();
    runWebinarSimulation(tuple);
  };
  const error = groups.error || campaigns.error || campaign.error || webinars.error || ownership.error || calendar.error || create.error || update.error || simulate.error;
  const groupName = (id: string) => groups.data?.groups.find(g => g.id === id)?.name ?? id;
  return (
    <div className="flex-1 overflow-auto p-6 md:p-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Development planning</h1>
        <p className="mt-2 text-muted-foreground">Work across synthetic teams and groups. New plans receive the designated development group on the server; change ownership below.</p>
        <ProvisionalBadge className="mt-2" />
      </header>
      {error && <p role="alert" className="rounded border border-destructive p-3 text-destructive">{planningError(error)}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Teams and groups</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {groups.isPending ? <p>Loading groups…</p> : <ul className="space-y-2">{groups.data?.groups.map(group => <li key={group.id}><strong>{group.name}</strong> · {group.kind}{group.parentId && ` · parent: ${groupName(group.parentId)}`}<div className="text-xs text-muted-foreground break-all">{group.id}</div></li>)}</ul>}
            <Form {...createForm}>
              <form className="space-y-3" onSubmit={createForm.handleSubmit(data => create.mutate({ data: { name: data.name.trim(), kind: data.kind === 'team' ? 'team' : 'group', ...(data.kind === 'group' && data.parentId ? { parentId: data.parentId } : {}), ...(data.accountableOwnerId ? { accountableOwnerId: data.accountableOwnerId } : {}) } }))}>
                <FormField control={createForm.control} name="name" rules={{ validate: value => !!value.trim() || 'Name is required' }} render={({ field }) => <FormItem><FormLabel>Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>} />
                <FormField control={createForm.control} name="kind" render={({ field }) => <FormItem><FormLabel>Unit type</FormLabel><FormControl><select {...field} className={selectClass}><option value="group">Group</option><option value="team">Team</option></select></FormControl></FormItem>} />
                {createForm.watch('kind') === 'group' && <FormField control={createForm.control} name="parentId" rules={{ validate: value => createForm.getValues('kind') !== 'group' || !!value || 'A group requires a parent team' }} render={({ field }) => <FormItem><FormLabel>Parent team (required for groups)</FormLabel><FormControl><select {...field} className={selectClass}><option value="">Choose team</option>{groups.data?.groups.filter(g => g.kind === 'team').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />}
                <FormField control={createForm.control} name="accountableOwnerId" render={({ field }) => <FormItem><FormLabel>Accountable owner (synthetic profile)</FormLabel><FormControl><select {...field} className={selectClass}><option value="">Server default</option>{groups.data?.profiles.map(p => <option key={p.id} value={p.id}>{p.name} — unverified</option>)}</select></FormControl></FormItem>} />
                <Button disabled={create.isPending || !groups.data}>Create development unit</Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Planning ownership and preview</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm font-medium">Campaign
               <select className={`${selectClass} mt-2`} value={campaignId} onChange={e => { setCampaignId(e.target.value); setActivityId(''); setOccurrenceId(''); setSimulationTuple(null); simulate.reset(); setNotice(''); }}><option value="">Choose campaign</option>{campaigns.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            {campaignId && <>
              <Link className="text-sm text-primary underline" href={`/campaigns/${campaignId}`}>Open campaign, activities, communications, schedules and evaluations</Link>
              <label className="block text-sm font-medium">Ownership target
                 <select className={`${selectClass} mt-2`} value={activityId} onChange={e => { setActivityId(e.target.value); setOccurrenceId(''); setSimulationTuple(null); simulate.reset(); }}><option value="">Campaign</option>{campaign.data?.map.activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </label>
              <p className="text-xs text-muted-foreground break-all">Stable record ID: {recordId}. Creator attribution is unverified and is not changed by this form. Accountable owner and owning group are separate planning fields.</p>
              {ownership.isPending ? <p>Loading ownership…</p> : ownership.data && <Form {...ownerForm}>
                <form className="space-y-3" onSubmit={ownerForm.handleSubmit(data => update.mutate({ type, id: recordId, data: { ...data, rowVersion: ownership.data!.ownership.rowVersion } }))}>
                  <FormField control={ownerForm.control} name="groupId" rules={{ required: 'Choose an owning group' }} render={({ field }) => <FormItem><FormLabel>Owning group</FormLabel><FormControl><select {...field} className={selectClass}><option value="">Choose group</option>{groups.data?.groups.filter(g => g.kind === 'group').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />
                  <FormField control={ownerForm.control} name="accountableOwnerId" rules={{ required: 'Choose an accountable owner' }} render={({ field }) => <FormItem><FormLabel>Accountable owner — unverified</FormLabel><FormControl><select {...field} className={selectClass}><option value="">Choose profile</option>{groups.data?.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />
                  <Button disabled={update.isPending}>Save planning ownership</Button>
                  {update.isError && <Button type="button" variant="outline" onClick={() => { update.reset(); void ownership.refetch(); }}>Reload ownership</Button>}
                </form>
              </Form>}
              <div className="border-t pt-4 space-y-2">
                {isWebinar && <label className="block text-sm font-medium">Webinar occurrence (required)
                   <select className={`${selectClass} mt-2`} value={occurrenceId} onChange={e => { setOccurrenceId(e.target.value); setSimulationTuple(null); simulate.reset(); }}>
                    <option value="">Choose occurrence</option>
                    {occurrences.map(session => <option key={session.id} value={session.id}>{session.name} · {session.sessionDate} {session.startTime} ({session.timezone})</option>)}
                  </select>
                </label>}
                {isWebinar && !webinars.isPending && occurrences.length === 0 && <p role="alert" className="text-sm text-destructive">No webinar occurrence belongs to this activity. Create an eligible new-standard occurrence before simulating.</p>}
                {isWebinar && <p className="text-xs text-muted-foreground">Only newly created synthetic occurrences explicitly opted into the exact standard are eligible. Neither default_5 nor legacy_9 template version proves eligibility; other occurrences are rejected without evaluation. No operational action is enabled.</p>}
                 {isWebinar && occurrenceId && (simulationContext.data
                   ? <p className="text-xs">Exact standard: {simulationContext.data.standard.id} · {simulationContext.data.standard.version} · Current source revision: {simulationContext.data.expectedRevision}</p>
                   : simulationContext.isPending ? <p className="text-xs">Checking occurrence eligibility and revision…</p>
                   : simulationContext.error ? <p role="alert" className="text-sm text-destructive">{planningError(simulationContext.error)}</p> : null)}
                {isWebinar ? <>
                  {!simulationTuple && <Button variant="outline" disabled={simulate.isPending || simulationContext.isFetching || !simulationContext.data} onClick={() => {
                    if (simulationContext.data) beginWebinarSimulation(simulationContext.data.expectedRevision);
                  }}>Run development webinar simulation</Button>}
                  {simulationTuple && <>
                    <p className="break-all text-xs">Fixed calculation: {simulationTuple.calculationAt} · Request revision: {simulationTuple.expectedRevision} · Retry key: {simulationTuple.idempotencyKey}</p>
                    <Button variant="outline" disabled={simulate.isPending} onClick={() => runWebinarSimulation(simulationTuple)}>Retry same calculation</Button>
                    <Button variant="outline" disabled={simulate.isPending || simulationContext.isFetching} onClick={async () => {
                      const refreshed = await simulationContext.refetch();
                      if (refreshed.data) beginWebinarSimulation(refreshed.data.expectedRevision);
                    }}>Start new calculation (refresh revision)</Button>
                  </>}
                </> : <Button variant="outline" disabled={simulate.isPending} onClick={() => simulate.mutate({ data: { campaignId, ...(activityId ? { activityId } : {}), label: 'Unverified development preview' } })}>Generic planning preview (not standards engine)</Button>}
                {simulate.data && (() => {
                  const result = simulate.data as SimulationResult;
                  return <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-2">
                    <strong>Development simulation—nonoperational</strong>
                    {result.message && <p>{result.message}</p>}
                    {result.operationalStatus === 'simulation-only' ? <>
                      <p>Activity: {result.activityId} · Occurrence: {result.occurrenceId}</p>
                      <p>Standard: {result.standard?.id} · Version: {result.standard?.version} · Calculated: {result.calculationAt}</p>
                      <p className="break-all">Release fingerprint: {result.releaseFingerprint} · Input fingerprint: {result.inputFingerprint}</p>
                      <FindingList title="Unresolved blockers" items={result.unresolvedBlockingFailures} />
                      <FindingList title="Blockers resolved by valid simulated exceptions" items={result.blockersResolvedByExceptions} />
                      <FindingList title="Nonblocking findings" items={result.nonblockingFailures} />
                      <FindingList title="Warnings" items={result.warnings} />
                      <FindingList title="Missing inputs" items={result.missingInputData} />
                      <FindingList title="Unavailable Foundation / external observations" items={result.unavailableExternalObservations} />
                      <FindingList title="Mapping errors" items={result.mappingErrors} />
                      <details><summary>Full structured simulation result</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(result, null, 2)}</pre></details>
                    </> : <p>Generic planning preview only; the webinar standards engine was not run.</p>}
                    <p>No approval, evidence, external action or operational authority is granted.</p>
                  </div>;
                })()}
              </div>
            </>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Group and consolidated calendar</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {calendarCampaignId && <p className="text-sm">Filtered to campaign: <strong>{campaigns.data?.find(c => c.id === calendarCampaignId)?.name || calendarCampaignId}</strong>. <Link className="text-primary underline" href="/development">Show all campaigns</Link></p>}
          <label className="block max-w-md text-sm font-medium">Calendar scope<select className={`${selectClass} mt-2`} value={groupFilter} onChange={e => { setGroupFilter(e.target.value); setCalendarCursor(undefined); }}><option value="">All development groups</option>{groups.data?.groups.filter(g => g.kind === 'group').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          {calendar.data && <div role="status" className="flex items-center gap-3 text-sm">
            <span>{calendar.data.returned} on this page · {calendar.data.total} in scope · {calendarCursor || calendar.data.hasMore ? 'Partial population' : 'Complete population'}</span>
            {calendarCursor && <Button variant="outline" onClick={() => setCalendarCursor(undefined)}>First page / refresh</Button>}
            {calendar.data.hasMore && <Button variant="outline" onClick={() => setCalendarCursor(calendar.data!.nextCursor!)}>Next page</Button>}
          </div>}
          <p className="text-sm text-muted-foreground">Source dates and source time zones are shown without browser-time-zone conversion. Status is planning status, not operational approval.</p>
          {calendar.isPending ? <p>Loading calendar…</p> : calendarEntries?.length === 0 ? <p>No activities in this calendar scope.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b"><th className="p-2">Activity</th><th className="p-2">Owning group</th><th className="p-2">Source date / timing</th><th className="p-2">Source time zone</th><th className="p-2">Planning status</th></tr></thead><tbody>{calendarEntries?.map(entry => <tr className="border-b align-top" key={entry.id}><td className="p-2"><Link className="text-primary underline" href={`/campaigns/${entry.campaignId}`}>{entry.title}</Link><div className="text-xs text-muted-foreground">{entry.id}</div></td><td className="p-2">{groupName(entry.groupId)}</td><td className="p-2">{entry.dates?.length ? entry.dates.map(date => <div key={date.id}>{date.date || 'Not scheduled'}</div>) : entry.date || 'Not scheduled'}</td><td className="p-2">{entry.dates?.length ? entry.dates.map(date => <div key={date.id}>{date.timeZone || 'Not specified'}</div>) : entry.timeZone || 'Not specified'}</td><td className="p-2">{entry.status}{entry.dates?.map(date => <div key={date.id}>{date.status}</div>)}<ProvisionalBadge className="ml-2" /></td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>
    </div>
  );
}