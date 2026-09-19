import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Communication,
  ActivityTask,
  DeliveryStatus,
  useGetCampaign,
  useCreateCommunication,
  useUpdateCommunication,
  useCreateActivityTask,
  useUpdateActivityTask,
  useDeleteActivityTask,
  useListWebinars,
  useGetWebinar,
  useUpdateWebinar,
  useEvaluateWebinar,
  getGetCampaignDeliveryQueryKey,
  getGetCampaignQueryOptions,
  getListWebinarsQueryOptions,
  getListWebinarsQueryKey,
  getGetWebinarQueryOptions,
  getGetWebinarStandardQueryKey,
  getGetWebinarStandardEligibilityQueryKey,
  getEvaluateWebinarQueryOptions,
  getListScheduleRulesQueryOptions,
  getListScheduledInstancesQueryOptions,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, AlertCircle, Plus, Mail, Clock, Users, ListFilter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import WebinarStandardPanel from './WebinarStandardPanel';
import ActivityTasksPanel from './ActivityTasksPanel';
import ActivityTaskSettingsPanel from './ActivityTaskSettingsPanel';

interface ActivityConfigDrawerProps {
  campaignId: string;
  node: { id: string; data: any };
  updateNodeData: (key: string, value: string) => void;
  onClose: () => void;
  communications: Communication[];
  tasks: ActivityTask[];
}

type CommunicationUpdate = Partial<Communication>;
type TaskUpdate = Partial<ActivityTask>;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'The change could not be saved.';
}

export default function ActivityConfigDrawer({
  campaignId,
  node,
  updateNodeData,
  onClose,
  communications,
  tasks
}: ActivityConfigDrawerProps) {
  const queryClient = useQueryClient();
  const createComm = useCreateCommunication();
  const updateComm = useUpdateCommunication();
  const createTask = useCreateActivityTask();
  const updateTask = useUpdateActivityTask();
  const deleteTask = useDeleteActivityTask();

  const isWebinar = node.data.type === 'Webinar';
  const { data: campaignData } = useGetCampaign(campaignId, { query: { ...getGetCampaignQueryOptions(campaignId), enabled: Boolean(campaignId) } });
  const { data: webinarSessions, error: webinarListError } = useListWebinars(campaignId, {
    query: { ...getListWebinarsQueryOptions(campaignId), enabled: isWebinar },
  });

  const webinarSession = webinarSessions?.find((session) => session.activityId === node.id);
  const sessionId = webinarSession?.id ?? '';

  const { data: webinarData, error: webinarLoadError } = useGetWebinar(campaignId, sessionId, {
    query: { ...getGetWebinarQueryOptions(campaignId, sessionId), enabled: isWebinar && Boolean(sessionId) },
  });
  const { data: webinarEvaluation } = useEvaluateWebinar(campaignId, sessionId, {
    query: { ...getEvaluateWebinarQueryOptions(campaignId, sessionId), enabled: isWebinar && Boolean(sessionId) },
  });
  const updateWebinarInfo = useUpdateWebinar();

  const [localError, setLocalError] = useState('');
  const [hasUnsavedWebinarChanges, setHasUnsavedWebinarChanges] = useState(false);

  const mutationError = [createComm.error, updateComm.error, createTask.error, updateTask.error, updateWebinarInfo.error, webinarListError, webinarLoadError].find(Boolean);
  const visibleError = localError || (mutationError ? errorMessage(mutationError) : '');

  const invalidateWebinar = () => {
    if (!sessionId) return;
    queryClient.invalidateQueries({ queryKey: getListWebinarsQueryKey(campaignId) });
    queryClient.invalidateQueries({ queryKey: getGetWebinarQueryOptions(campaignId, sessionId).queryKey });
    queryClient.invalidateQueries({ queryKey: getGetWebinarStandardQueryKey(campaignId, sessionId) });
    queryClient.invalidateQueries({ queryKey: getGetWebinarStandardEligibilityQueryKey(campaignId, sessionId) });
    queryClient.invalidateQueries({ queryKey: getEvaluateWebinarQueryOptions(campaignId, sessionId).queryKey });
    queryClient.invalidateQueries({ queryKey: getListScheduledInstancesQueryOptions(campaignId).queryKey });
    queryClient.invalidateQueries({ queryKey: getListScheduleRulesQueryOptions(campaignId).queryKey });
    queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
  };

  const updateWebinar = (data: Parameters<typeof updateWebinarInfo.mutate>[0]['data']) => {
    if (!sessionId) {
      setLocalError('No webinar session is linked to this activity.');
      return;
    }
    updateWebinarInfo.mutate({ id: campaignId, sessionId, data }, {
      onSuccess: invalidateWebinar,
      onError: (error) => setLocalError(errorMessage(error)),
    });
  };

  const handleAddCommunication = () => {
    setLocalError('');
    createComm.mutate({
      id: campaignId,
      data: {
        activityId: node.id,
        name: 'New Communication',
        status: 'Estimated',
        type: 'Email',
        timing: 'TBD',
        sortOrder: communications.length + 1,
        owner: 'Unassigned'
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
      },
      onError: (error) => setLocalError(errorMessage(error)),
    });
  };

  const handleAddTask = (data?: any, onSuccess?: () => void, onError?: (err: any) => void) => {
    setLocalError('');
    createTask.mutate({
      id: campaignId,
      data: {
        activityId: node.id,
        name: data?.name || 'New Task',
        status: 'Estimated', // Keep legacy for type safety
        type: data?.type || 'Asset',
        timing: 'TBD', // Keep legacy for type safety
        sortOrder: tasks.length + 1,
        owner: data?.owner || 'Unassigned',
        ...( {
          stage: data?.stage || 'Not Started',
          blocked: data?.blocked || false,
          blockedReason: data?.blockedReason || null,
          effortPoints: data?.effortPoints !== undefined ? data.effortPoints : 3,
          supportingOwner: data?.supportingOwner,
          requestingTeam: data?.requestingTeam,
          requester: data?.requester,
          notes: data?.notes,
          trigger: data?.trigger || 'gtm_launch',
          offsetDays: data?.offsetDays,
          businessDayStrategy: data?.businessDayStrategy || 'calendar'
        } as any )
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
        if (onSuccess) onSuccess();
      },
      onError: (error) => {
        setLocalError(errorMessage(error));
        if (onError) onError(error);
      },
    });
  };

  const handleUpdateComm = (commId: string, updates: CommunicationUpdate) => {
    setLocalError('');
    updateComm.mutate({
      id: campaignId,
      itemId: commId,
      data: updates
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
      },
      onError: (error) => setLocalError(errorMessage(error)),
    });
  };

  const handleUpdateTask = (taskId: string, updates: TaskUpdate, onSuccess?: () => void, onError?: (err: any) => void) => {
    setLocalError('');
    updateTask.mutate({
      id: campaignId,
      itemId: taskId,
      data: updates as any
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
        if (onSuccess) onSuccess();
      },
      onError: (error) => {
        setLocalError(errorMessage(error));
        if (onError) onError(error);
      },
    });
  };

  const handleDeleteTask = (taskId: string) => {
    setLocalError('');
    deleteTask.mutate({
      id: campaignId,
      itemId: taskId
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
      },
      onError: (error) => setLocalError(errorMessage(error)),
    });
  };

  const sortedComms = [...communications].sort((a, b) => a.sortOrder - b.sortOrder);
  const sortedTasks = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);

  const handleClose = () => {
    if (isWebinar && hasUnsavedWebinarChanges) {
      const discard = window.confirm('This webinar has unsaved standard drafts. Close and discard them?');
      if (!discard) return;
    }
    onClose();
  };

  return (
    <div className="w-full sm:w-[480px] bg-card border-l border-border h-full flex flex-col absolute right-0 top-0 shadow-xl animate-in slide-in-from-right-8 z-20">
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
        <h3 className="font-semibold text-sm">Activity Configuration</h3>
         <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={handleClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {visibleError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {visibleError}
            </div>
          )}

          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">General</h4>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Activity Name</Label>
              <Input
                value={String(node.data.name || '')}
                onChange={(e) => updateNodeData('name', e.target.value)}
                className="h-8 text-sm font-medium"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Audience</Label>
                <Input
                  value={String(node.data.audience || '')}
                  onChange={(e) => updateNodeData('audience', e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select
                  value={String(node.data.status || 'Estimated')}
                  onValueChange={(val) => updateNodeData('status', val)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Decision needed">Decision needed</SelectItem>
                    <SelectItem value="Estimated">Estimated</SelectItem>
                    <SelectItem value="Known">Known</SelectItem>
                    <SelectItem value="Confirmed">Confirmed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {Boolean(node.data.conflict) && (
              <div className="p-3 bg-destructive/10 rounded-md border border-destructive/20 text-sm mt-4">
                <div className="font-semibold text-destructive flex items-center gap-1.5 mb-1">
                  <AlertCircle className="h-4 w-4" /> Conflict Flagged
                </div>
                <div className="text-destructive/80 text-xs">
                  This activity overlaps with a portfolio-wide restriction.
                </div>
              </div>
            )}
          </div>

          <ActivityTaskSettingsPanel campaignId={campaignId} node={node} />

          {/* Webinar Specifics */}
          {isWebinar && (
            <div className="space-y-4 pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-foreground border-b border-border pb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Webinar Configuration
              </h4>

              {!webinarData ? (
                <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  {sessionId ? 'Loading the webinar session…' : 'No webinar session is linked to this activity. Create a session before editing webinar details.'}
                </div>
              ) : <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Session Name</Label>
                  <Input
                    defaultValue={webinarData.name}
                    onBlur={(event) => { if (event.target.value !== webinarData.name) updateWebinar({ name: event.target.value }); }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Session Date</Label>
                  <Input
                    type="date"
                    defaultValue={webinarData.sessionDate}
                    onBlur={(e) => { if(e.target.value !== webinarData.sessionDate) updateWebinar({ sessionDate: e.target.value }) }}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Time & Duration</Label>
                  <div className="flex gap-2">
                    <Input
                      type="time"
                      defaultValue={webinarData.startTime}
                      onBlur={(e) => { if(e.target.value !== webinarData.startTime) updateWebinar({ startTime: e.target.value }) }}
                      className="h-8 text-sm flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="Mins"
                      defaultValue={webinarData.durationMinutes}
                      onBlur={(e) => { if(Number(e.target.value) !== webinarData.durationMinutes) updateWebinar({ durationMinutes: Number(e.target.value) }) }}
                      className="h-8 text-sm w-16"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Timezone</Label>
                  <Select
                    value={webinarData.timezone}
                    onValueChange={(val) => updateWebinar({ timezone: val })}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!['UTC', 'America/New_York', 'America/Los_Angeles'].includes(webinarData.timezone) && <SelectItem value={webinarData.timezone}>{webinarData.timezone}</SelectItem>}
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">EST</SelectItem>
                      <SelectItem value="America/Los_Angeles">PST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Platform</Label>
                  <Select
                    value={webinarData.platform}
                    onValueChange={(val) => updateWebinar({ platform: val })}
                  >
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!['zoom', 'teams', 'webex', 'on24'].includes(webinarData.platform) && <SelectItem value={webinarData.platform}>{webinarData.platform}</SelectItem>}
                      <SelectItem value="zoom">Zoom</SelectItem>
                      <SelectItem value="teams">Teams</SelectItem>
                      <SelectItem value="webex">Webex</SelectItem>
                      <SelectItem value="on24">ON24</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Speakers</Label>
                  <Input
                    defaultValue={webinarData.speakers?.map(s => s.name).join(', ') || ''}
                    onBlur={(e) => {
                      const names = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                      updateWebinar({ speakers: names.map(n => ({ name: n })) });
                    }}
                    placeholder="Comma separated names"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id={`webinar-suppress`}
                      checked={webinarData.registrationRule?.suppressRecruitmentAfterRegistration || false}
                      onCheckedChange={(c) => updateWebinar({ registrationRule: { ...webinarData.registrationRule, suppressRecruitmentAfterRegistration: !!c } })}
                    />
                    <label htmlFor={`webinar-suppress`} className="text-xs font-medium leading-none">Suppress Recruitment After Registration</label>
                  </div>
                </div>
              </div>}

              <div className="space-y-2 mt-4 bg-muted/20 p-3 rounded-md border border-border">
                <h5 className="text-xs font-semibold flex items-center justify-between">
                  Audience Branch Outcomes
                  {sessionId && <span className="text-[10px] font-normal text-muted-foreground">Session results</span>}
                </h5>
                <div className="space-y-1.5 divide-y divide-border">
                  {webinarEvaluation && webinarEvaluation.length > 0 ? webinarEvaluation.map(outcome => (
                    <div key={outcome.person.id} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-medium">{outcome.person.name}</div>
                        <div className="text-[10px] text-muted-foreground">Branch: <span className="font-mono">{outcome.branch}</span></div>
                      </div>
                      <div className="flex gap-2">
                        <span className={cn("px-1.5 py-0.5 rounded text-[9px] uppercase", outcome.registrationResult === 'registered' ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>Reg</span>
                        <span className={cn("px-1.5 py-0.5 rounded text-[9px] uppercase", outcome.attendanceResult === 'attended' ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500")}>Att</span>
                      </div>
                    </div>
                  )) : (
                    <div className="text-xs text-muted-foreground text-center py-2">No outcomes yet.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {isWebinar ? (
             <WebinarStandardPanel
               campaignId={campaignId}
               sessionId={sessionId}
               sessionName={webinarData?.name || 'webinar'}
               onDirtyChange={setHasUnsavedWebinarChanges}
             />
          ) : (
          <div className="space-y-4 pt-4 border-t border-border">
            <div className="flex items-center justify-between pb-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Communications
              </h4>
              <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={handleAddCommunication}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>

            <div className="space-y-3">
              {sortedComms.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6 bg-muted/10 border border-dashed rounded-md">
                  No communications linked.
                </div>
              ) : (
                sortedComms.map((baseComm) => {
                  const comm = baseComm;
                  return (
                  <div key={comm.id} className="group flex flex-col gap-2 p-3 bg-card border border-border rounded-md text-sm transition-colors hover:border-primary/40 min-w-0 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <Input
                        defaultValue={comm.name}
                        onBlur={(e) => { if(e.target.value !== comm.name) handleUpdateComm(comm.id, { name: e.target.value }) }}
                        className="h-7 text-sm font-semibold bg-transparent border-transparent px-1 -ml-1 focus-visible:ring-1 hover:border-input min-w-0 flex-1"
                      />
                      <Select
                        value={comm.status}
                        onValueChange={(val) => handleUpdateComm(comm.id, { status: val as DeliveryStatus })}
                      >
                        <SelectTrigger className={cn(
                          "h-6 w-[115px] text-[11px] shrink-0 border-transparent font-medium",
                          comm.status === 'Confirmed' ? "bg-green-100 text-green-700 hover:bg-green-200" :
                          comm.status === 'Known' ? "bg-blue-100 text-blue-700 hover:bg-blue-200" :
                          comm.status === 'Estimated' ? "bg-amber-100 text-amber-700 hover:bg-amber-200" :
                          comm.status === 'Decision needed' ? "bg-red-100 text-red-700 hover:bg-red-200" :
                          "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        )}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Decision needed">Decision needed</SelectItem>
                          <SelectItem value="Estimated">Estimated</SelectItem>
                          <SelectItem value="Known">Known</SelectItem>
                          <SelectItem value="Confirmed">Confirmed</SelectItem>
                          <SelectItem value="Not applicable">Not applicable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground px-1">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[80px]">
                        <Clock className="h-3 w-3 shrink-0" />
                        <Input
                          defaultValue={comm.timing}
                          onBlur={(e) => { if (e.target.value !== comm.timing) handleUpdateComm(comm.id, { timing: e.target.value }) }}
                          className="h-6 text-xs bg-transparent border-transparent p-0 focus-visible:ring-1 hover:border-input min-w-0"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase font-semibold">Type:</span>
                        <Select
                          value={comm.communicationType || comm.type}
                          onValueChange={(value) => handleUpdateComm(comm.id, { communicationType: value })}
                        >
                          <SelectTrigger className="h-6 w-[90px] text-[10px] bg-transparent border-transparent px-1 hover:border-input"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[comm.communicationType || comm.type, 'Email', 'SMS', 'Push', 'In-App', 'Webinar', 'Other']
                              .filter((value, index, values) => value && values.indexOf(value) === index)
                              .map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase font-semibold">Owner:</span>
                        <Input
                          defaultValue={comm.owner || ''}
                          onBlur={(e) => { if (e.target.value !== comm.owner) handleUpdateComm(comm.id, { owner: e.target.value }) }}
                          placeholder="Unassigned"
                          className="h-6 w-16 text-xs bg-transparent border-transparent p-0 focus-visible:ring-1 hover:border-input min-w-0"
                        />
                      </div>
                    </div>

                    <Accordion type="single" collapsible className="w-full mt-2">
                      <AccordionItem value="details" className="border-none">
                        <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline bg-muted/30 px-2 rounded-sm">
                          <span className="flex items-center gap-1"><ListFilter className="h-3 w-3" /> Details & Routing</span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-3 pb-1 space-y-4 px-1">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground">Audience Branch</Label>
                              <Select
                                value={comm.audienceBranchId || 'none'}
                                onValueChange={(value) => value !== 'none' && handleUpdateComm(comm.id, { audienceBranchId: value })}
                              >
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select map connection" /></SelectTrigger>
                                <SelectContent>
                                  {!comm.audienceBranchId && <SelectItem value="none">Select map connection</SelectItem>}
                                  {comm.audienceBranchId && !(campaignData?.map.connections ?? []).some((connection) => connection.id === comm.audienceBranchId) && (
                                    <SelectItem value={comm.audienceBranchId}>Current branch ({comm.audienceBranchId.slice(0, 8)})</SelectItem>
                                  )}
                                  {(campaignData?.map.connections ?? []).map((connection) => (
                                    <SelectItem key={connection.id} value={connection.id}>
                                      {connection.trigger} · {connection.sentence || connection.id.slice(0, 8)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground">Channel</Label>
                              <Select
                                value={comm.channel || 'none'}
                                onValueChange={(v) => v !== 'none' && handleUpdateComm(comm.id, { channel: v })}
                              >
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Select channel" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Select channel</SelectItem>
                                  <SelectItem value="marketo">Marketo</SelectItem>
                                  <SelectItem value="braze">Braze</SelectItem>
                                  <SelectItem value="salesforce">Salesforce</SelectItem>
                                  <SelectItem value="hubspot">HubSpot</SelectItem>
                                  <SelectItem value="adobe_journey">Adobe Journey</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                  )})
              )}
            </div>
          </div>
          )}

          <ActivityTasksPanel
            campaignId={campaignId}
            activityId={node.id}
            tasks={sortedTasks}
            onCreate={handleAddTask}
            onUpdate={handleUpdateTask}
            onDelete={handleDeleteTask}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
