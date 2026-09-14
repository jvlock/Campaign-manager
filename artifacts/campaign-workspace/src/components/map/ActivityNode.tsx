import { Handle, Position } from '@xyflow/react';
import { Activity } from '@workspace/api-client-react';
import { AlertTriangle, Clock, User, Mail, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ActivityNode({ data }: { data: Activity & { communications?: any[], tasks?: any[] } }) {
  const commsCount = data.communications?.length || 0;
  const openTasks = data.tasks?.filter(t => t.status !== 'Confirmed' && t.status !== 'Not applicable')?.length || 0;

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

        <div className="pt-2 mt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            <span>{commsCount} {commsCount === 1 ? 'communication' : 'communications'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            <span className={cn(openTasks > 0 ? "font-medium text-foreground" : "")}>
              {openTasks} open {openTasks === 1 ? 'task' : 'tasks'}
            </span>
          </div>
        </div>
      </div>

      <Handle type="target" position={Position.Left} className="w-2 h-4 rounded-sm border-2 bg-muted border-border" />
      <Handle type="source" position={Position.Right} className="w-2 h-4 rounded-sm border-2 bg-primary border-primary" />
    </div>
  );
}
