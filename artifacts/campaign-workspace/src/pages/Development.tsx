import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { useGetCampaign, useListCampaigns, useGetDevelopmentGroups, useGetDevelopmentOwnership, useGetDevelopmentCalendar, useCreateDevelopmentGroup, useUpdateDevelopmentOwnership, useSimulateDevelopmentWorkflow } from '@workspace/api-client-react';
import { Link, useSearch } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ProvisionalBadge } from '@/components/governance/ProvisionalNotice';

interface Group { id: string; name: string; kind: string; parentId: string | null; accountableOwnerId: string | null }
interface Groups { groups: Group[]; profiles: { id: string; name: string }[] }
interface Entry { id: string; campaignId: string; groupId: string; title: string; date: string | null; timeZone: string | null; status: string; accountableOwnerId: string | null; dates?: { id: string; date: string | null; timeZone: string | null; status: string }[] }
interface Ownership { groupId?: string; accountableOwnerId?: string | null; group_id?: string; accountable_owner_id?: string | null; creatorId?: string | null }
interface CreateUnit { name: string; kind: string; parentId: string; accountableOwnerId: string }
const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm';

function planningError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data as { error?: string | { message?: string } };
    if (typeof data?.error === 'string') return data.error;
    if (data?.error?.message) return data.error.message;
  }
  return error instanceof Error ? error.message : 'Unable to complete this planning request.';
}

export default function Development() {
  const search = useSearch();
  const calendarCampaignId = new URLSearchParams(search).get('campaignId') || '';
  const client = useQueryClient();
  const [groupFilter, setGroupFilter] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [activityId, setActivityId] = useState('');
  const [notice, setNotice] = useState('');
  const groups = useGetDevelopmentGroups({ query: { queryKey: ['development-groups'], select: data => data as unknown as Groups, refetchInterval: 30000 } });
  const campaigns = useListCampaigns();
  const campaign = useGetCampaign(campaignId, { query: { queryKey: ['/api/campaigns', campaignId], enabled: Boolean(campaignId) } });
  const type = activityId ? 'activities' : 'campaigns';
  const recordId = activityId || campaignId;
  const ownership = useGetDevelopmentOwnership(type, recordId, { query: {
    queryKey: ['development-ownership', type, recordId],
    select: data => data as unknown as { ownership: Ownership },
    enabled: Boolean(recordId), refetchInterval: 30000,
  } });
  const calendar = useGetDevelopmentCalendar(groupFilter ? { groupId: groupFilter } : undefined, { query: {
    queryKey: ['development-calendar', groupFilter],
    select: data => data as unknown as { entries: Entry[] },
    refetchInterval: 30000,
  } });
  const calendarEntries = calendar.data?.entries.filter(entry => !calendarCampaignId || entry.campaignId === calendarCampaignId);
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
  const error = groups.error || campaigns.error || campaign.error || ownership.error || calendar.error || create.error || update.error || simulate.error;
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
              <select className={`${selectClass} mt-2`} value={campaignId} onChange={e => { setCampaignId(e.target.value); setActivityId(''); simulate.reset(); setNotice(''); }}><option value="">Choose campaign</option>{campaigns.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            {campaignId && <>
              <Link className="text-sm text-primary underline" href={`/campaigns/${campaignId}`}>Open campaign, activities, communications, schedules and evaluations</Link>
              <label className="block text-sm font-medium">Ownership target
                <select className={`${selectClass} mt-2`} value={activityId} onChange={e => { setActivityId(e.target.value); simulate.reset(); }}><option value="">Campaign</option>{campaign.data?.map.activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </label>
              <p className="text-xs text-muted-foreground break-all">Stable record ID: {recordId}. Creator attribution is unverified and is not changed by this form. Accountable owner and owning group are separate planning fields.</p>
              {ownership.isPending ? <p>Loading ownership…</p> : ownership.data && <Form {...ownerForm}>
                <form className="space-y-3" onSubmit={ownerForm.handleSubmit(data => update.mutate({ type, id: recordId, data }))}>
                  <FormField control={ownerForm.control} name="groupId" rules={{ required: 'Choose an owning group' }} render={({ field }) => <FormItem><FormLabel>Owning group</FormLabel><FormControl><select {...field} className={selectClass}><option value="">Choose group</option>{groups.data?.groups.filter(g => g.kind === 'group').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />
                  <FormField control={ownerForm.control} name="accountableOwnerId" rules={{ required: 'Choose an accountable owner' }} render={({ field }) => <FormItem><FormLabel>Accountable owner — unverified</FormLabel><FormControl><select {...field} className={selectClass}><option value="">Choose profile</option>{groups.data?.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />
                  <Button disabled={update.isPending}>Save planning ownership</Button>
                </form>
              </Form>}
              <div className="border-t pt-4 space-y-2">
                <Button variant="outline" disabled={simulate.isPending} onClick={() => simulate.mutate({ data: { campaignId, ...(activityId ? { activityId } : {}), label: 'Unverified development preview' } })}>Preview simulated approval</Button>
                <p className="text-xs text-muted-foreground">Nonoperational dry run. No approval or authenticated evidence is recorded; this cannot establish readiness or override webinar controls.</p>
                {simulate.data && <div role="status" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><strong>SIMULATED · UNVERIFIED · NONOPERATIONAL</strong><p>{String(simulate.data.message)}</p><p>Not authoritative. Operational readiness is not established.</p></div>}
              </div>
            </>}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Group and consolidated calendar</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {calendarCampaignId && <p className="text-sm">Filtered to campaign: <strong>{campaigns.data?.find(c => c.id === calendarCampaignId)?.name || calendarCampaignId}</strong>. <Link className="text-primary underline" href="/development">Show all campaigns</Link></p>}
          <label className="block max-w-md text-sm font-medium">Calendar scope<select className={`${selectClass} mt-2`} value={groupFilter} onChange={e => setGroupFilter(e.target.value)}><option value="">All development groups</option>{groups.data?.groups.filter(g => g.kind === 'group').map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <p className="text-sm text-muted-foreground">Source dates and source time zones are shown without browser-time-zone conversion. Status is planning status, not operational approval.</p>
          {calendar.isPending ? <p>Loading calendar…</p> : calendarEntries?.length === 0 ? <p>No activities in this calendar scope.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="border-b"><th className="p-2">Activity</th><th className="p-2">Owning group</th><th className="p-2">Source date / timing</th><th className="p-2">Source time zone</th><th className="p-2">Planning status</th></tr></thead><tbody>{calendarEntries?.map(entry => <tr className="border-b align-top" key={entry.id}><td className="p-2"><Link className="text-primary underline" href={`/campaigns/${entry.campaignId}`}>{entry.title}</Link><div className="text-xs text-muted-foreground">{entry.id}</div></td><td className="p-2">{groupName(entry.groupId)}</td><td className="p-2">{entry.dates?.length ? entry.dates.map(date => <div key={date.id}>{date.date || 'Not scheduled'}</div>) : entry.date || 'Not scheduled'}</td><td className="p-2">{entry.dates?.length ? entry.dates.map(date => <div key={date.id}>{date.timeZone || 'Not specified'}</div>) : entry.timeZone || 'Not specified'}</td><td className="p-2">{entry.status}{entry.dates?.map(date => <div key={date.id}>{date.status}</div>)}<ProvisionalBadge className="ml-2" /></td></tr>)}</tbody></table></div>}
        </CardContent>
      </Card>
    </div>
  );
}