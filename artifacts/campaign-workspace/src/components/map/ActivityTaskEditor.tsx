import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { ActivityTask } from '@workspace/api-client-react';

interface ActivityTaskEditorProps {
  campaignId: string;
  activityId: string;
  task: ActivityTask;
  onSave: (data: any) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export default function ActivityTaskEditor({ campaignId, activityId, task, onSave, onCancel, isPending }: ActivityTaskEditorProps) {
  const [data, setData] = useState({
    name: task.name || '',
    type: task.type || 'Asset',
    owner: task.owner || '',
    supportingOwner: task.supportingOwner || '',
    requestingTeam: task.requestingTeam || '',
    requester: task.requester || '',
    notes: task.notes || '',
    stage: task.stage || 'Not Started',
    blocked: task.blocked || false,
    blockedReason: task.blockedReason || null,
    effortPoints: typeof task.effortPoints === 'number' ? task.effortPoints : 1,
    offsetDays: task.offsetDays === undefined ? null : task.offsetDays,
    businessDayStrategy: task.businessDayStrategy || 'calendar',
    trigger: task.trigger || 'gtm_launch'
  });

  const handleSave = () => {
    // Send only editable fields, do NOT send dueAt
    const payload = {
      ...data,
      // If offsetDays is an empty string or undefined, send null to use default
      offsetDays: data.offsetDays === null ? null : Number(data.offsetDays)
    };
    onSave(payload);
  };

  return (
    <div className="space-y-4 bg-muted/20 p-4 rounded-md border border-border shadow-sm">
      <div className="flex justify-between items-center pb-2 border-b border-border/50">
        <h5 className="font-semibold text-sm text-foreground">Edit Execution Task</h5>
      </div>
      
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Name</Label>
        <Input value={data.name} onChange={e => setData({...data, name: e.target.value})} className="h-8 text-sm" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Stage</Label>
          <Select value={data.stage} onValueChange={v => setData({...data, stage: v as any})}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Not Started">Not Started</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Ready for Review">Ready for Review</SelectItem>
              <SelectItem value="Complete">Complete</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Effort Points</Label>
          <div className="flex gap-1.5">
            <Button variant={data.effortPoints === 1 ? 'default' : 'outline'} size="sm" className="h-8 flex-1" onClick={() => setData({...data, effortPoints: 1})}>S (1)</Button>
            <Button variant={data.effortPoints === 3 ? 'default' : 'outline'} size="sm" className="h-8 flex-1" onClick={() => setData({...data, effortPoints: 3})}>M (3)</Button>
            <Button variant={data.effortPoints === 5 ? 'default' : 'outline'} size="sm" className="h-8 flex-1" onClick={() => setData({...data, effortPoints: 5})}>L (5)</Button>
            <Input type="number" min="0" value={data.effortPoints} onChange={e => setData({...data, effortPoints: Math.max(0, Number(e.target.value))})} className="h-8 w-14 px-2 text-center" />
          </div>
        </div>
      </div>

      <div className="p-3 border border-border bg-background rounded-md space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox 
            id={`task-blocked-${task.id}`} 
            checked={data.blocked} 
            onCheckedChange={(c) => setData({...data, blocked: !!c, blockedReason: c ? data.blockedReason || 'On Hold' : null})} 
          />
          <Label htmlFor={`task-blocked-${task.id}`} className="text-xs font-medium text-destructive cursor-pointer">Task is Blocked</Label>
        </div>
        {data.blocked && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">Blocked Reason</Label>
            <Select value={data.blockedReason || 'On Hold'} onValueChange={v => setData({...data, blockedReason: v as any})}>
              <SelectTrigger className="h-8 text-sm border-destructive/30 focus:ring-destructive/30"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="On Hold">On Hold</SelectItem>
                <SelectItem value="Content">Content</SelectItem>
                <SelectItem value="Technical">Technical</SelectItem>
                <SelectItem value="Legal">Legal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Owner</Label>
          <Input value={data.owner} onChange={e => setData({...data, owner: e.target.value})} className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Supporting Owner</Label>
          <Input value={data.supportingOwner} onChange={e => setData({...data, supportingOwner: e.target.value})} className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Requesting Team</Label>
          <Input value={data.requestingTeam} onChange={e => setData({...data, requestingTeam: e.target.value})} className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Requester</Label>
          <Input value={data.requester} onChange={e => setData({...data, requester: e.target.value})} className="h-8 text-sm" />
        </div>
      </div>

      <div className="space-y-2 p-3 bg-background border border-border rounded-md">
        <Label className="text-xs font-semibold text-foreground flex justify-between items-center">
          Scheduling Overrides
          <span className="text-[10px] font-normal text-muted-foreground px-1.5 bg-muted rounded">Configurable Defaults</span>
        </Label>
        <div className="flex gap-2">
          <Select value={data.trigger} onValueChange={v => setData({...data, trigger: v as any})}>
            <SelectTrigger className="h-8 text-sm w-32 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="gtm_launch">GTM Launch</SelectItem>
              <SelectItem value="event">Event</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" placeholder="Default" value={data.offsetDays ?? ''} onChange={e => setData({...data, offsetDays: e.target.value === '' ? null : Number(e.target.value)})} className="h-8 w-20 text-sm" title="Offset Days (leave blank for default)" />
          <Select value={data.businessDayStrategy} onValueChange={v => setData({...data, businessDayStrategy: v as any})}>
            <SelectTrigger className="h-8 text-sm flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="calendar">Calendar Days</SelectItem>
              <SelectItem value="skip_weekends">Skip Weekends</SelectItem>
              <SelectItem value="previous_business_day">Prev Business Day</SelectItem>
              <SelectItem value="next_business_day">Next Business Day</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="text-[10px] text-muted-foreground flex justify-between items-center pt-1">
          <span className="flex items-center gap-1">Effective Offset: <span className="font-mono">{task.effectiveOffsetDays ?? '-'}</span> days</span>
          <div className="flex items-center gap-1">
            <span>Computed Due At:</span>
            <span className="font-medium text-foreground">{task.dueAt ? new Date(task.dueAt).toLocaleString() : 'TBD'}</span>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Notes</Label>
        <Textarea value={data.notes} onChange={e => setData({...data, notes: e.target.value})} className="h-16 text-sm resize-none" placeholder="Task execution notes..." />
      </div>

      <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>Cancel</Button>
        <Button size="sm" onClick={handleSave} disabled={isPending || (data.blocked && !data.blockedReason)}>
          {isPending ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
