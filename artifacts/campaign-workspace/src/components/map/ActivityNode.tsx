import { Handle, Position } from '@xyflow/react';
import { Activity } from '@workspace/api-client-react';
import { AlertTriangle, Clock, User, Mail, CheckSquare, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type ActivityNodeData = Activity & {
  communications?: any[];
  tasks?: any[];
  connectionSourceId?: string;
  onConnectionAction?: (activityId: string) => void;
};

export default function ActivityNode({ data }: { data: ActivityNodeData }) {
  const commsCount = data.communications?.length || 0;

  const tasks = (data.tasks || []) as any[];
  const stages = {
    notStarted: tasks.filter(t => t.stage === 'Not Started').length,
    inProgress: tasks.filter(t => t.stage === 'In Progress').length,
    ready: tasks.filter(t => t.stage === 'Ready for Review').length,
    complete: tasks.filter(t => t.stage === 'Complete').length,
  };
  const blockedCount = tasks.filter(t => t.blocked).length;

  const connectionSourceId = data.connectionSourceId;
  const isConnectionSource = connectionSourceId === data.id;
  const isConnectionTarget = Boolean(connectionSourceId) && !isConnectionSource;
  const connectionActionLabel = isConnectionSource
    ? 'Cancel connection source'
    : isConnectionTarget
      ? `Connect to ${data.name}`
      : `Start connection from ${data.name}`;

  return (
    <div className={cn(
      "w-72 bg-card rounded-md border-2 shadow-sm transition-all relative",
      data.conflict ? "border-destructive/80 shadow-destructive/20" : "border-border hover:border-primary/50",
      data.status === 'Decision needed' ? "border-dashed" : "border-solid"
    )}>
      {data.conflict && (
        <div className="absolute -top-3 -right-3 h-6 w-6 bg-destructive rounded-full flex items-center justify-center shadow-md animate-in zoom-in">
          <AlertTriangle className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div className="p-3 border-b border-border bg-muted/30 rounded-t-sm flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate flex-1">
          {data.type}
        </div>
        <div className={cn(
          "text-[10px] px-1.5 py-0.5 rounded font-medium",
          data.status === 'Confirmed' ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
          data.status === 'Known' ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" :
          data.status === 'Estimated' ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
          "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        )}>
          {data.status}
        </div>
      </div>

      <div className="p-3 space-y-3">
        <h3 className="font-semibold text-foreground leading-tight text-sm">{data.name}</h3>

        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <User className="h-3 w-3 shrink-0" />
            <span className="truncate">{data.audience}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            <span className="truncate">{data.timing}</span>
          </div>
        </div>

        <div className="pt-3 mt-3 border-t border-border space-y-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Mail className="h-3.5 w-3.5" />
              <span>{commsCount} comms</span>
            </div>
          </div>

          {(
            <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px] bg-muted/30 p-2 rounded border border-border/50">
              <div className="flex justify-between items-center">
                <span>Not Started:</span>
                <span className="font-semibold text-slate-700">{stages.notStarted}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>In Progress:</span>
                <span className="font-semibold text-amber-600">{stages.inProgress}</span>
              </div>
              <div className="flex justify-between items-center">
                 <span>Ready for Review:</span>
                <span className="font-semibold text-blue-600">{stages.ready}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Complete:</span>
                <span className="font-semibold text-green-600">{stages.complete}</span>
              </div>
               {(
                 <div className={cn("col-span-2 flex justify-between items-center px-1.5 py-1 rounded mt-1", blockedCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                  <span className="flex items-center gap-1 font-bold uppercase tracking-wider"><AlertTriangle className="h-3 w-3" /> Blocked</span>
                  <span className="font-bold">{blockedCount}</span>
                </div>
              )}
            </div>
          )}

          {data.onConnectionAction && (
            <button
              type="button"
              data-testid={`button-connect-activity-${data.id}`}
              aria-label={connectionActionLabel}
              title={connectionActionLabel}
              onClick={(event) => {
                event.stopPropagation();
                data.onConnectionAction?.(data.id);
              }}
              className={cn(
                "nodrag nopan flex min-h-9 w-full items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[11px] font-medium transition-colors touch-manipulation",
                isConnectionSource
                  ? "border-primary bg-primary/10 text-primary hover:bg-primary/15"
                  : isConnectionTarget
                    ? "border-secondary bg-secondary/10 text-secondary-foreground hover:bg-secondary/15"
                    : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{isConnectionSource ? 'Cancel source' : isConnectionTarget ? 'Connect here' : 'Connect from here'}</span>
            </button>
          )}
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        aria-label={`Connect into ${data.name}`}
        title={`Connect into ${data.name}`}
        data-testid={`handle-target-${data.id}`}
        className="nodrag nopan !h-8 !w-4 rounded-md border-2 !border-border !bg-muted shadow-sm touch-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`Connect from ${data.name}`}
        title={`Connect from ${data.name}`}
        data-testid={`handle-source-${data.id}`}
        className="nodrag nopan !h-8 !w-4 rounded-md border-2 !border-primary !bg-primary shadow-sm touch-none"
      />
    </div>
  );
}
