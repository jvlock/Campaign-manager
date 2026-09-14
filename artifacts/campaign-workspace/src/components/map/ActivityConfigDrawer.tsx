import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { 
  Communication, 
  ActivityTask, 
  DeliveryStatus, 
  TaskType,
  ScheduleRule,
  ScheduledInstance,
  useGetCampaign,
  useCreateCommunication,
  useUpdateCommunication,
  useCreateActivityTask,
  useUpdateActivityTask,
  useCreateScheduleRule,
  useListScheduleRules,
  useListScheduledInstances,
  useRecomputeSchedule,
  useAdjustScheduledInstance,
  useUpdateScheduleRule,
  useListWebinars,
  useGetWebinar,
  useUpdateWebinar,
  useEvaluateWebinar,
  getGetCampaignDeliveryQueryKey,
  getGetCampaignQueryOptions,
  getListWebinarsQueryOptions,
  getListWebinarsQueryKey,
  getListScheduleRulesQueryOptions,
  getListScheduledInstancesQueryOptions,
  getGetWebinarQueryOptions,
  getGetWebinarStandardQueryKey,
  getGetWebinarStandardEligibilityQueryKey,
  getEvaluateWebinarQueryOptions,
  ScheduleRuleInputBusinessDayStrategy,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { X, AlertCircle, Plus, Mail, CheckSquare, Clock, Check, Calendar, Users, ListFilter, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import WebinarStandardPanel from './WebinarStandardPanel';

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
type InstanceAdjustment = { calculatedAt: string; reason: string };

/**
 * Convert a webinar wall-clock date/time in its IANA timezone into the instant
 * expected by the schedule API. Never use the browser's timezone or current
 * time as a schedule anchor.
 */
export function webinarAnchorAt(sessionDate: string, startTime: string, timezone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sessionDate);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  if (!match || !timeMatch) return null;
  try {
    // Constructing the formatter validates the IANA timezone without using
    // the current instant as an implicit anchor.
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return null;
  }
  const wallClockUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(timeMatch[1]), Number(timeMatch[2]));
  let anchor = new Date(wallClockUtc);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(anchor).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    anchor = new Date(wallClockUtc - (localAsUtc - anchor.getTime()));
  }
  return Number.isNaN(anchor.getTime()) ? null : anchor.toISOString();
}

function localDateTimeValue(instant: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  const createSchedule = useCreateScheduleRule();
  const adjustInstance = useAdjustScheduledInstance();

  const { data: scheduleRules } = useListScheduleRules(campaignId, { query: getListScheduleRulesQueryOptions(campaignId) });
  const { data: scheduledInstances } = useListScheduledInstances(campaignId, { query: getListScheduledInstancesQueryOptions(campaignId) });
  const recomputeSchedule = useRecomputeSchedule();
  const updateSchedule = useUpdateScheduleRule();

  const isWebinar = node.data.type === 'Webinar';
  const { data: campaignData } = useGetCampaign(campaignId, { query: { ...getGetCampaignQueryOptions(campaignId), enabled: Boolean(campaignId) } });
  const { data: webinarSessions, error: webinarListError } = useListWebinars(campaignId, {
    query: { ...getListWebinarsQueryOptions(campaignId), enabled: isWebinar },
  });
  // The map node id is an activity id. Webinar endpoints require the session
  // id, so resolve the session through the campaign-scoped list first.
  const webinarSession = webinarSessions?.find((session) => session.activityId === node.id);
  const sessionId = webinarSession?.id ?? '';
  const { data: webinarData, error: webinarLoadError } = useGetWebinar(campaignId, sessionId, {
    query: { ...getGetWebinarQueryOptions(campaignId, sessionId), enabled: isWebinar && Boolean(sessionId) },
  });
  const { data: webinarEvaluation } = useEvaluateWebinar(campaignId, sessionId, {
    query: { ...getEvaluateWebinarQueryOptions(campaignId, sessionId), enabled: isWebinar && Boolean(sessionId) },
  });
  const updateWebinarInfo = useUpdateWebinar();
  const [adjustments, setAdjustments] = useState<Record<string, InstanceAdjustment>>({});
  const [localError, setLocalError] = useState('');
  const [hasUnsavedWebinarChanges, setHasUnsavedWebinarChanges] = useState(false);

  const mutationError = [createComm.error, updateComm.error, createTask.error, updateTask.error, createSchedule.error, adjustInstance.error, updateSchedule.error, recomputeSchedule.error, updateWebinarInfo.error, webinarListError, webinarLoadError]
    .find(Boolean);
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

  const handleAddTask = () => {
    setLocalError('');
    createTask.mutate({
      id: campaignId,
      data: {
        activityId: node.id,
        name: 'New Task',
        status: 'Estimated',
        type: 'Asset',
        timing: 'TBD',
        sortOrder: tasks.length + 1,
        owner: 'Unassigned'
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
      },
      onError: (error) => setLocalError(errorMessage(error)),
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

  const handleUpdateTask = (taskId: string, updates: TaskUpdate) => {
    setLocalError('');
    updateTask.mutate({
      id: campaignId,
      itemId: taskId,
      data: updates
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
      },
      onError: (error) => setLocalError(errorMessage(error)),
    });
  };

  // Sort by sortOrder
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
    <div className="w-full sm:w-[450px] bg-card border-l border-border h-full flex flex-col absolute right-0 top-0 shadow-xl animate-in slide-in-from-right-8 z-20">
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/20 shrink-0">
        <h3 className="font-semibold text-sm">Activity Configuration</h3>
         <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={handleClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-8">
          {visibleError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {visibleError}
            </div>
          )}
          {/* Main Activity Properties */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground border-b border-border pb-2">General</h4>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Activity Name</Label>
              <Input 
                value={String(node.data.name || '')}
                onChange={(e) => updateNodeData('name', e.target.value)}
                className="h-8 text-sm"
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

          {/* Webinar Specifics */}
          {node.data.type === 'Webinar' && (
            <div className="space-y-4">
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

          {/* Child Communications */}
          {node.data.type === 'Webinar' ? (
             <WebinarStandardPanel
               campaignId={campaignId}
               sessionId={sessionId}
               sessionName={webinarData?.name || 'webinar'}
               onDirtyChange={setHasUnsavedWebinarChanges}
             />
          ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Communications
              </h4>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleAddCommunication}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            
            <div className="space-y-3">
              {sortedComms.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-md">
                  No communications linked.
                </div>
              ) : (
                sortedComms.map((baseComm) => {
                  const comm = baseComm;
                  return (
                  <div key={comm.id} className="group flex flex-col gap-2 p-3 bg-muted/30 border border-border rounded-md text-sm transition-colors hover:border-primary/40 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Input 
                        defaultValue={comm.name} 
                        onBlur={(e) => { if(e.target.value !== comm.name) handleUpdateComm(comm.id, { name: e.target.value }) }}
                        className="h-7 text-sm font-medium bg-transparent border-transparent px-1 -ml-1 focus-visible:ring-1 hover:border-input min-w-0 flex-1"
                      />
                      <Select 
                        value={comm.status}
                        onValueChange={(val) => handleUpdateComm(comm.id, { status: val as DeliveryStatus })}
                      >
                        <SelectTrigger className={cn(
                          "h-6 w-[115px] text-[11px] shrink-0 border-transparent",
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
                        <AccordionTrigger className="py-1 text-xs text-muted-foreground hover:no-underline">
                          <span className="flex items-center gap-1"><ListFilter className="h-3 w-3" /> Communication Details</span>
                        </AccordionTrigger>
                        <AccordionContent className="pt-2 pb-1 space-y-4">
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
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Not set" /></SelectTrigger>
                                <SelectContent>
                                  {!comm.channel && <SelectItem value="none">Not set</SelectItem>}
                                  <SelectItem value="email">Email</SelectItem>
                                  <SelectItem value="sms">SMS</SelectItem>
                                  <SelectItem value="push">Push</SelectItem>
                                  <SelectItem value="in-app">In-App</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground">Approval Status</Label>
                              <Select 
                                 value={comm.approvalStatus || 'Not started'} 
                                onValueChange={(v) => handleUpdateComm(comm.id, { approvalStatus: v })}
                              >
                                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                   {[comm.approvalStatus, 'Not started', 'Needs review', 'Approved', 'Rejected']
                                     .filter((value, index, values) => value && values.indexOf(value) === index)
                                     .map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] uppercase text-muted-foreground">Blocking Task</Label>
                              <Select 
                                value={comm.blockingDependencyTaskIds?.[0] || 'none'} 
                                onValueChange={(v) => handleUpdateComm(comm.id, { blockingDependencyTaskIds: v === 'none' ? [] : [v] })}
                              >
                                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {tasks.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-[10px] uppercase text-muted-foreground">QA Checklist</Label>
                            <div className="flex gap-4">
                              <div className="flex items-center space-x-2">
                                <Checkbox 
                                  id={`qa-copy-${comm.id}`} 
                                  checked={comm.qaContentApproved || false}
                                  onCheckedChange={(c) => handleUpdateComm(comm.id, { qaContentApproved: !!c })}
                                />
                                <label htmlFor={`qa-copy-${comm.id}`} className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Copy</label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox 
                                  id={`qa-audience-${comm.id}`} 
                                  checked={comm.qaAudienceConfirmed || false}
                                  onCheckedChange={(c) => handleUpdateComm(comm.id, { qaAudienceConfirmed: !!c })}
                                />
                                <label htmlFor={`qa-audience-${comm.id}`} className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Audience</label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox 
                                  id={`qa-links-${comm.id}`} 
                                  checked={comm.qaLinksVerified || false}
                                  onCheckedChange={(c) => handleUpdateComm(comm.id, { qaLinksVerified: !!c })}
                                />
                                <label htmlFor={`qa-links-${comm.id}`} className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Links</label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox id={`qa-timing-${comm.id}`} checked={comm.qaTimingVerified || false} onCheckedChange={(checked) => handleUpdateComm(comm.id, { qaTimingVerified: !!checked })} />
                                <label htmlFor={`qa-timing-${comm.id}`} className="text-xs font-medium leading-none">Timing</label>
                              </div>
                              <div className="flex items-center space-x-2">
                                <Checkbox id={`qa-owner-${comm.id}`} checked={comm.qaOwnerConfirmed || false} onCheckedChange={(checked) => handleUpdateComm(comm.id, { qaOwnerConfirmed: !!checked })} />
                                <label htmlFor={`qa-owner-${comm.id}`} className="text-xs font-medium leading-none">Owner</label>
                              </div>
                            </div>
                          </div>

                          {(() => {
                            const rule = scheduleRules?.find((candidate) => candidate.communicationId === comm.id);
                            const instances = scheduledInstances?.filter((instance) => instance.ruleId === rule?.id) ?? [];
                            const webinarAnchor = webinarData
                              ? webinarAnchorAt(webinarData.sessionDate, webinarData.startTime, webinarData.timezone)
                              : null;

                            const handleUpdateRule = (updates: Partial<ScheduleRule>) => {
                              if (!rule) return;
                              updateSchedule.mutate({
                                id: campaignId,
                                ruleId: rule.id,
                                data: {
                                  activityId: rule.activityId,
                                  communicationId: rule.communicationId,
                                  anchorActivityId: rule.anchorActivityId,
                                  offsetDays: updates.offsetDays ?? rule.offsetDays,
                                  offsetMinutes: updates.offsetMinutes ?? rule.offsetMinutes,
                                  direction: updates.direction ?? rule.direction,
                                  businessDayStrategy: updates.businessDayStrategy ?? rule.businessDayStrategy,
                                  audienceLocalTimezone: updates.audienceLocalTimezone ?? rule.audienceLocalTimezone,
                                  timezone: updates.timezone ?? rule.timezone,
                                  targetSendTime: updates.targetSendTime === undefined ? rule.targetSendTime : updates.targetSendTime,
                                  enabled: updates.enabled ?? rule.enabled,
                                  rowVersion: rule.rowVersion,
                                },
                              }, {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListScheduleRulesQueryOptions(campaignId).queryKey });
                                },
                                onError: (error) => setLocalError(errorMessage(error)),
                              });
                            };

                            const handleCreateRule = () => {
                              setLocalError('');
                              createSchedule.mutate({
                                id: campaignId,
                                data: {
                                  activityId: node.id,
                                  communicationId: comm.id,
                                  anchorActivityId: null,
                                  offsetDays: 0,
                                  offsetMinutes: 0,
                                  direction: 'after',
                                  businessDayStrategy: 'calendar',
                                  audienceLocalTimezone: false,
                                  timezone: webinarData?.timezone || 'UTC',
                                  targetSendTime: null,
                                  enabled: true,
                                },
                              }, {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListScheduleRulesQueryOptions(campaignId).queryKey });
                                  queryClient.invalidateQueries({ queryKey: getListScheduledInstancesQueryOptions(campaignId).queryKey });
                                },
                                onError: (error) => setLocalError(errorMessage(error)),
                              });
                            };

                            const doRecompute = () => {
                              if (!rule) return;
                              if (!webinarAnchor) {
                                setLocalError('Recompute requires the actual webinar session date, start time, and timezone; no current-time fallback is used.');
                                return;
                              }
                              recomputeSchedule.mutate({
                                id: campaignId,
                                data: {
                                  ruleId: rule.id,
                                  anchorAt: webinarAnchor,
                                  timezone: rule.timezone,
                                  reason: 'Manual recompute from webinar session anchor',
                                },
                              }, {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListScheduledInstancesQueryOptions(campaignId).queryKey });
                                },
                                onError: (error) => setLocalError(errorMessage(error)),
                              });
                            };

                            const adjust = (instance: ScheduledInstance) => {
                              const value = adjustments[instance.id] ?? {
                                calculatedAt: localDateTimeValue(instance.adjustedAt || instance.calculatedAt),
                                reason: '',
                              };
                              if (!value.reason.trim() || !value.calculatedAt) {
                                setLocalError('An adjusted send time and reason are required.');
                                return;
                              }
                              adjustInstance.mutate({
                                id: campaignId,
                                instanceId: instance.id,
                                data: {
                                  calculatedAt: new Date(value.calculatedAt).toISOString(),
                                  reason: value.reason.trim(),
                                  rowVersion: instance.rowVersion,
                                },
                              }, {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListScheduledInstancesQueryOptions(campaignId).queryKey });
                                  setAdjustments((current) => {
                                    const next = { ...current };
                                    delete next[instance.id];
                                    return next;
                                  });
                                },
                                onError: (error) => setLocalError(errorMessage(error)),
                              });
                            };

                            return rule ? (
                              <div className="space-y-2 border-t border-border pt-3">
                                <div className="flex justify-between items-center">
                                  <Label className="text-[10px] uppercase text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Schedule Rule</Label>
                                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={doRecompute} disabled={recomputeSchedule.isPending || !webinarAnchor}>
                                    {recomputeSchedule.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Recompute
                                  </Button>
                                </div>
                                {!webinarAnchor && <div className="text-[10px] text-muted-foreground">Recompute is disabled until this activity has a webinar session anchor.</div>}
                                <div className="grid grid-cols-2 gap-2 bg-background p-2 rounded border border-border">
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Days before/after</Label>
                                    <Input type="number" min={0} defaultValue={rule.offsetDays} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value !== rule.offsetDays) handleUpdateRule({ offsetDays: value }); }} className="h-6 text-xs" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Minutes</Label>
                                    <Input type="number" min={0} defaultValue={rule.offsetMinutes} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value !== rule.offsetMinutes) handleUpdateRule({ offsetMinutes: value }); }} className="h-6 text-xs" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Direction</Label>
                                    <Select value={rule.direction} onValueChange={(value) => handleUpdateRule({ direction: value as ScheduleRule['direction'] })}>
                                      <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent><SelectItem value="before">Before</SelectItem><SelectItem value="after">After</SelectItem></SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Business-day strategy</Label>
                                    <Select value={rule.businessDayStrategy} onValueChange={(value) => handleUpdateRule({ businessDayStrategy: value as ScheduleRule['businessDayStrategy'] })}>
                                      <SelectTrigger className="h-6 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        {Object.values(ScheduleRuleInputBusinessDayStrategy).map((strategy) => <SelectItem key={strategy} value={strategy}>{strategy.replaceAll('_', ' ')}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Timezone (IANA)</Label>
                                    <Input defaultValue={rule.timezone} onBlur={(event) => { if (event.target.value !== rule.timezone) handleUpdateRule({ timezone: event.target.value }); }} className="h-6 text-xs" />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Send time (local)</Label>
                                    <Input type="time" defaultValue={rule.targetSendTime || ''} onBlur={(event) => { const value = event.target.value || null; if (value !== rule.targetSendTime) handleUpdateRule({ targetSendTime: value }); }} className="h-6 text-xs" />
                                  </div>
                                  <div className="col-span-2 flex items-center space-x-2 mt-1">
                                    <Checkbox id={`audience-local-${comm.id}`} checked={rule.audienceLocalTimezone} onCheckedChange={(checked) => handleUpdateRule({ audienceLocalTimezone: checked === true })} />
                                    <label htmlFor={`audience-local-${comm.id}`} className="text-[10px]">Use audience local timezone</label>
                                  </div>
                                </div>

                                {instances.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    <Label className="text-[9px] text-muted-foreground">Schedule calculation and adjustment</Label>
                                    <div className="bg-background rounded border border-border divide-y divide-border text-[10px]">
                                      {instances.map((instance) => {
                                        const value = adjustments[instance.id] ?? {
                                          calculatedAt: localDateTimeValue(instance.adjustedAt || instance.calculatedAt),
                                          reason: '',
                                        };
                                        return (
                                          <div key={instance.id} className="p-2 space-y-2">
                                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                                              <div><span className="text-muted-foreground">Original:</span> {new Date(instance.originalCalculatedAt).toLocaleString()}</div>
                                              <div><span className="text-muted-foreground">Calculated:</span> {new Date(instance.calculatedAt).toLocaleString()}</div>
                                              <div><span className="text-muted-foreground">Adjusted:</span> {instance.adjustedAt ? new Date(instance.adjustedAt).toLocaleString() : 'None'}</div>
                                            </div>
                                            <div className="text-muted-foreground">Reason: {instance.adjustmentReason || 'No manual adjustment'}</div>
                                            <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
                                              <Input type="datetime-local" value={value.calculatedAt} onChange={(event) => setAdjustments((current) => ({ ...current, [instance.id]: { ...value, calculatedAt: event.target.value } }))} className="h-7 text-[10px]" />
                                              <Input value={value.reason} onChange={(event) => setAdjustments((current) => ({ ...current, [instance.id]: { ...value, reason: event.target.value } }))} placeholder="Adjustment reason" className="h-7 text-[10px]" />
                                              <Button variant="outline" size="sm" className="h-7 text-[10px]" onClick={() => adjust(instance)} disabled={adjustInstance.isPending}>Adjust</Button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="border-t border-border pt-3 space-y-2">
                                <div className="text-xs text-muted-foreground">No schedule rule configured for this communication.</div>
                                <Button variant="outline" size="sm" onClick={handleCreateRule} disabled={createSchedule.isPending}>
                                  {createSchedule.isPending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Plus className="mr-2 h-3 w-3" />}
                                  Create schedule rule
                                </Button>
                              </div>
                            );
                          })()}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>
                );
                })
              )}
            </div>
          </div>
          )}

          {/* Linked Tasks */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                Tasks
              </h4>
              <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleAddTask}>
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            
            <div className="space-y-3">
              {sortedTasks.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-md">
                  No linked tasks.
                </div>
              ) : (
                sortedTasks.map((task) => (
                  <div key={task.id} className="group flex flex-col gap-2 p-3 bg-muted/30 border border-border rounded-md text-sm transition-colors hover:border-primary/40 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Input 
                        defaultValue={task.name} 
                        onBlur={(e) => { if (e.target.value !== task.name) handleUpdateTask(task.id, { name: e.target.value }) }}
                        className="h-7 text-sm font-medium bg-transparent border-transparent px-1 -ml-1 focus-visible:ring-1 hover:border-input flex-1 min-w-0"
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-6 px-2 text-[11px] shrink-0 gap-1.5",
                          task.status === 'Confirmed' ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-muted text-muted-foreground hover:bg-muted/80"
                        )}
                        onClick={() => handleUpdateTask(task.id, { status: task.status === 'Confirmed' ? 'Estimated' : 'Confirmed' })}
                      >
                        <Check className="h-3 w-3" />
                        {task.status === 'Confirmed' ? 'Done' : 'Mark Done'}
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground px-1">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[80px]">
                        <Clock className="h-3 w-3 shrink-0" />
                        <Input 
                          defaultValue={task.timing}
                          onBlur={(e) => { if (e.target.value !== task.timing) handleUpdateTask(task.id, { timing: e.target.value }) }}
                          className="h-6 text-xs bg-transparent border-transparent p-0 focus-visible:ring-1 hover:border-input min-w-0"
                        />
                      </div>
                      <Select 
                        value={task.type}
                        onValueChange={(val) => handleUpdateTask(task.id, { type: val as TaskType })}
                      >
                        <SelectTrigger className="h-6 w-[100px] text-[10px] bg-transparent border-transparent px-1 hover:border-input shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Asset">Asset</SelectItem>
                          <SelectItem value="Landing page">Landing page</SelectItem>
                          <SelectItem value="Approval">Approval</SelectItem>
                          <SelectItem value="Tracking">Tracking</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] uppercase font-semibold">Owner:</span>
                        <Input 
                          defaultValue={task.owner || ''}
                          onBlur={(e) => { if (e.target.value !== task.owner) handleUpdateTask(task.id, { owner: e.target.value }) }}
                          placeholder="Unassigned"
                          className="h-6 w-16 text-xs bg-transparent border-transparent p-0 focus-visible:ring-1 hover:border-input min-w-0"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </ScrollArea>
    </div>
  );
}
