import { useState } from 'react';
import { 
  CampaignDetail, 
  useGetCampaignDelivery, 
  getGetCampaignDeliveryQueryKey,
  Communication,
  ActivityTask
} from '@workspace/api-client-react';
import { Loader2, Mail, CheckSquare, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface CampaignDeliveryTabProps {
  campaign: CampaignDetail;
}

export default function CampaignDeliveryTab({ campaign }: CampaignDeliveryTabProps) {
  const { data: delivery, isLoading } = useGetCampaignDelivery(campaign.id, {
    query: { enabled: !!campaign.id, queryKey: getGetCampaignDeliveryQueryKey(campaign.id) }
  });

  const [filterActivity, setFilterActivity] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
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

  const filteredTasks = tasks.filter(t => 
    (filterActivity === 'all' || t.activityId === filterActivity) &&
    (filterStatus === 'all' || t.status === filterStatus) &&
    (filterOwner === 'all' || t.owner === filterOwner)
  ).sort((a, b) => a.sortOrder - b.sortOrder);

  // Group by activity for better presentation
  const getActivityName = (id: string) => {
    const act = campaign.map.activities.find(a => a.id === id);
    return act?.name || 'Unlinked activity';
  };

  const statuses = ['Decision needed', 'Estimated', 'Known', 'Confirmed', 'Not applicable'];
  const activities = campaign.map.activities;
  const allOwners = Array.from(new Set([...comms.map(c => c.owner), ...tasks.map(t => t.owner)].filter((owner): owner is string => Boolean(owner))));

  return (
    <div className="space-y-8">
      {/* Rollup Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-card p-4 rounded-md border border-border">
        <div className="flex items-center gap-2 text-sm font-medium shrink-0">
          <Filter className="h-4 w-4 text-muted-foreground" /> Filters
        </div>
        <div className="flex flex-wrap gap-3 w-full sm:w-auto">
          <select 
            className="h-9 flex-1 min-w-[120px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterActivity}
            onChange={e => setFilterActivity(e.target.value)}
          >
            <option value="all">All Activities</option>
            {activities.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <select 
            className="h-9 flex-1 min-w-[120px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            <option value="all">All Statuses</option>
            {statuses.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          
          <select 
            className="h-9 flex-1 min-w-[120px] rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={filterOwner}
            onChange={e => setFilterOwner(e.target.value)}
          >
            <option value="all">All Owners</option>
            {allOwners.map(owner => (
              owner ? <option key={owner} value={owner}>{owner}</option> : null
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Communications Rollup */}
        <div className="min-w-0">
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <Mail className="h-5 w-5 text-primary" /> Communications ({filteredComms.length})
          </h3>
          <div className="bg-card border border-border rounded-md overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
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
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No communications match filters.</td>
                  </tr>
                ) : (
                  filteredComms.map((comm) => {
                    return (
                    <tr key={comm.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{comm.name}</td>
                       <td className="px-4 py-3">{comm.communicationType || comm.type || 'Not set'}</td>
                       <td className="px-4 py-3 text-muted-foreground capitalize">{comm.channel || 'Not set'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{getActivityName(comm.activityId)}</td>
                      <td className="px-4 py-3">{comm.timing}</td>
                      <td className="px-4 py-3 text-muted-foreground">{comm.owner || 'Unassigned'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-medium inline-block",
                          comm.status === 'Confirmed' ? "bg-green-100 text-green-700" :
                          comm.status === 'Known' ? "bg-blue-100 text-blue-700" :
                          comm.status === 'Estimated' ? "bg-amber-100 text-amber-700" :
                          comm.status === 'Decision needed' ? "bg-red-100 text-red-700" :
                          "bg-slate-100 text-slate-700"
                        )}>
                          {comm.status}
                        </span>
                        {comm.approvalStatus && comm.approvalStatus !== 'pending' && (
                           <div className="text-[10px] mt-1 text-muted-foreground uppercase">{comm.approvalStatus.replace('_', ' ')}</div>
                        )}
                      </td>
                    </tr>
                  )})
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tasks Rollup */}
        <div className="min-w-0">
          <h3 className="text-lg font-semibold flex items-center gap-2 mb-4">
            <CheckSquare className="h-5 w-5 text-primary" /> Tasks ({filteredTasks.length})
          </h3>
          <div className="bg-card border border-border rounded-md overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Activity</th>
                  <th className="px-4 py-3">Timing</th>
                  <th className="px-4 py-3">Owner</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No tasks match filters.</td>
                  </tr>
                ) : (
                  filteredTasks.map(task => (
                    <tr key={task.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{task.name}</td>
                      <td className="px-4 py-3">{task.type}</td>
                      <td className="px-4 py-3 text-muted-foreground">{getActivityName(task.activityId)}</td>
                      <td className="px-4 py-3">{task.timing}</td>
                      <td className="px-4 py-3 text-muted-foreground">{task.owner || 'Unassigned'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-medium inline-block",
                          task.status === 'Confirmed' ? "bg-green-100 text-green-700" :
                          task.status === 'Known' ? "bg-blue-100 text-blue-700" :
                          task.status === 'Estimated' ? "bg-amber-100 text-amber-700" :
                          task.status === 'Decision needed' ? "bg-red-100 text-red-700" :
                          "bg-slate-100 text-slate-700"
                        )}>
                          {task.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="pt-6 border-t border-border">
        <h2 className="text-xl font-semibold mb-6">UTM Links & Tracking</h2>
        <div className="rounded-md border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">Generated URL</th>
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
                    <td className="px-4 py-3 font-mono text-xs truncate max-w-[300px] text-muted-foreground" title={link.fullUrl}>{link.fullUrl}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{link.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
