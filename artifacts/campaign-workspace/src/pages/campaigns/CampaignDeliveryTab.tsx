import { useState } from 'react';
import { Link } from 'wouter';
import {
  CampaignDetail,
  useGetCampaignDelivery,
  getGetCampaignDeliveryQueryKey,
} from '@workspace/api-client-react';
import { Loader2, Mail, CheckSquare, Filter, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import CapacityManagementPanel from '@/components/delivery/CapacityManagementPanel';
import OffsetDefaultsPanel from '@/components/delivery/OffsetDefaultsPanel';
import { ProvisionalBadge, ProvisionalNotice } from '@/components/governance/ProvisionalNotice';

interface CampaignDeliveryTabProps {
  campaign: CampaignDetail;
}

export default function CampaignDeliveryTab({ campaign }: CampaignDeliveryTabProps) {
  const { data: delivery, isLoading } = useGetCampaignDelivery(campaign.id, {
    query: { enabled: !!campaign.id, queryKey: getGetCampaignDeliveryQueryKey(campaign.id) }
  });

  const [filterActivity, setFilterActivity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterOwner, setFilterOwner] = useState<string>('all');

  if (isLoading) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  const activityIds = new Set(campaign.map.activities.map((activity) => activity.id));
  const comms = (delivery?.communications || []).filter((communication) => activityIds.has(communication.activityId));
  const tasks = (delivery?.tasks || []).filter((task) => activityIds.has(task.activityId));

  const filteredComms = comms.filter(c =>
    (filterActivity === 'all' || c.activityId === filterActivity) &&
    (filterStatus === 'all' || c.status === filterStatus) &&
    (filterOwner === 'all' || c.owner === filterOwner)
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  const filteredTasks = (tasks as any[]).filter(t =>
    (filterActivity === 'all' || t.activityId === filterActivity) &&
    (filterStage === 'all' || t.stage === filterStage) &&
    (filterOwner === 'all' || t.owner === filterOwner || t.supportingOwner === filterOwner)
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  const getActivityName = (id: string) => {
    const act = campaign.map.activities.find(a => a.id === id);
    return act?.name || 'Unlinked activity';
  };

  const statuses = ['Decision needed', 'Estimated', 'Known', 'Confirmed', 'Not applicable'];
  const stages = ['Not Started', 'In Progress', 'Ready for Review', 'Complete'];
  const activities = campaign.map.activities;
  const allOwners = Array.from(new Set([
    ...comms.map(c => c.owner),
    ...tasks.map(t => t.owner),
    ...tasks.map(t => (t as any).supportingOwner)
  ].filter(Boolean)));

  return (
    <Tabs defaultValue="tasks" className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-card p-4 rounded-md border border-border">
        <TabsList className="bg-muted">
          <TabsTrigger value="tasks">Execution Tasks</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="capacity">Team Capacity</TabsTrigger>
          <TabsTrigger value="defaults">Defaults</TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium shrink-0">
            <Filter className="h-4 w-4 text-muted-foreground" /> Filters
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <select
              className="h-8 flex-1 min-w-[120px] rounded-md border border-input bg-transparent px-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={filterActivity}
              onChange={e => setFilterActivity(e.target.value)}
            >
              <option value="all">All Activities</option>
              {activities.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>

            <select
              className="h-8 flex-1 min-w-[120px] rounded-md border border-input bg-transparent px-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={filterOwner}
              onChange={e => setFilterOwner(e.target.value)}
            >
              <option value="all">All Owners</option>
              {allOwners.map(owner => (
                <option key={owner as string} value={owner as string}>{owner as string}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <TabsContent value="tasks" className="space-y-4 outline-none">
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-primary" /> Execution Tasks ({filteredTasks.length})
          </h3>
          <select
            className="h-8 w-[140px] rounded-md border border-input bg-card px-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterStage}
            onChange={e => setFilterStage(e.target.value)}
          >
            <option value="all">All Stages</option>
            {stages.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="bg-card border border-border rounded-md overflow-x-auto shadow-sm">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Task Name</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3 text-center">Blocked</th>
                <th className="px-4 py-3 text-center">Effort</th>
                <th className="px-4 py-3">Due At</th>
                <th className="px-4 py-3">Owner / Support</th>
                <th className="px-4 py-3">Requester</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredTasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground bg-muted/10">No tasks match filters.</td>
                </tr>
              ) : (
                filteredTasks.map(task => (
                  <tr key={task.id} className="hover:bg-muted/30 group">
                    <td className="px-4 py-3 font-medium text-foreground">{task.name}</td>
                    <td className="px-4 py-3">
                      <Link href={`/campaigns/${campaign.id}?activity=${task.activityId}&tab=map`} className="text-primary hover:underline font-medium">
                        {getActivityName(task.activityId)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider inline-block",
                        task.stage === 'Complete' ? "bg-green-100 text-green-700" :
                        task.stage === 'Ready for Review' ? "bg-blue-100 text-blue-700" :
                        task.stage === 'In Progress' ? "bg-amber-100 text-amber-700" :
                        "bg-slate-100 text-slate-700"
                      )}>
                        {task.stage || 'Not Started'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {task.blocked && (
                        <div className="inline-flex items-center gap-1 bg-destructive/10 text-destructive text-[10px] font-bold px-1.5 py-0.5 rounded uppercase">
                          <AlertTriangle className="h-3 w-3" /> {task.blockedReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-medium">{task.effortPoints > 0 ? task.effortPoints : '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'TBD'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-foreground">{task.owner || 'Unassigned'}</span>
                        {task.supportingOwner && <span className="text-[10px] text-muted-foreground uppercase">Support: {task.supportingOwner}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      <div className="flex flex-col">
                        <span>{task.requester || '-'}</span>
                        {task.requestingTeam && <span className="text-[10px] uppercase">{task.requestingTeam}</span>}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="communications" className="space-y-4 outline-none">
        <div className="flex justify-between items-end mb-4">
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" /> Communications ({filteredComms.length})
          </h3>
          <select
            className="h-8 w-[140px] rounded-md border border-input bg-card px-2 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="all">All Statuses</option>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="bg-card border border-border rounded-md overflow-x-auto shadow-sm">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Timing</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredComms.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground bg-muted/10">No communications match filters.</td>
                </tr>
              ) : (
                filteredComms.map((comm) => (
                  <tr key={comm.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{comm.name}</td>
                    <td className="px-4 py-3">{comm.communicationType || comm.type || 'Not set'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="capitalize">{comm.channel || 'Not set'}</div>
                      {comm.channel && <ProvisionalBadge className="mt-1" />}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/campaigns/${campaign.id}?activity=${comm.activityId}&tab=map`} className="text-primary hover:underline font-medium">
                        {getActivityName(comm.activityId)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{comm.timing}</td>
                    <td className="px-4 py-3 text-muted-foreground">{comm.owner || 'Unassigned'}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider inline-block",
                        comm.status === 'Confirmed' ? "bg-green-100 text-green-700" :
                        comm.status === 'Known' ? "bg-blue-100 text-blue-700" :
                        comm.status === 'Estimated' ? "bg-amber-100 text-amber-700" :
                        comm.status === 'Decision needed' ? "bg-red-100 text-red-700" :
                        "bg-slate-100 text-slate-700"
                      )}>
                        {comm.status}
                      </span>
                      {comm.approvalStatus && comm.approvalStatus !== 'pending' && (
                         <div className="text-[10px] mt-1 text-amber-700 uppercase">
                           Historical workflow: {comm.approvalStatus.replace('_', ' ')} · not governance approval
                         </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="capacity" className="outline-none">
         <CapacityManagementPanel campaignId={campaign.id} />
      </TabsContent>

      <TabsContent value="defaults" className="outline-none">
         <OffsetDefaultsPanel />
      </TabsContent>

      <div className="pt-8 border-t border-border mt-8">
        <h2 className="text-lg font-semibold mb-4 text-foreground">UTM Links & Tracking</h2>
        <ProvisionalNotice compact className="mb-3" />
        <div className="rounded-md border border-border bg-card overflow-x-auto shadow-sm">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Provisional UTM preview</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {campaign.utmLinks.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No UTM links generated yet.</td>
                </tr>
              ) : (
                campaign.utmLinks.map(link => (
                  <tr key={link.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 truncate max-w-[200px]" title={link.destinationUrl}>{link.destinationUrl}</td>
                    <td className="px-4 py-3 max-w-[400px]">
                      <div className="font-mono text-[11px] truncate text-muted-foreground" title={link.fullUrl}>{link.fullUrl}</div>
                      <ProvisionalBadge className="mt-1" />
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800">Draft preview</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Tabs>
  );
}
