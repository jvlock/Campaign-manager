import { useState } from 'react';
import { ActivityTask } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Plus, CheckSquare, Edit, AlertTriangle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import ActivityTaskEditor from './ActivityTaskEditor';

interface ActivityTasksPanelProps {
  campaignId: string;
  activityId: string;
  tasks: ActivityTask[];
  onCreate: (data: any, onSuccess: () => void, onError: (err: any) => void) => void;
  onUpdate: (taskId: string, data: any, onSuccess: () => void, onError: (err: any) => void) => void;
  onDelete: (taskId: string) => void;
}

export default function ActivityTasksPanel({ campaignId, activityId, tasks, onCreate, onUpdate, onDelete }: ActivityTasksPanelProps) {
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSave = (data: any) => {
    setIsPending(true);
    const onSuccess = () => {
      setIsPending(false);
      setEditingTaskId(null);
    };
    const onError = () => {
      setIsPending(false);
    };

    if (editingTaskId === 'new') {
      onCreate(data, onSuccess, onError);
    } else {
      if (editingTaskId) onUpdate(editingTaskId, data, onSuccess, onError);
    }
  };

  if (editingTaskId) {
    const task = editingTaskId === 'new' 
      ? { id: 'new', name: '', type: 'Asset', stage: 'Not Started', blocked: false, effortPoints: 3 } as any
      : tasks.find(t => t.id === editingTaskId);
    if (!task) return null;
    return (
      <ActivityTaskEditor 
        campaignId={campaignId}
        activityId={activityId}
        task={task} 
        onSave={handleSave}
        onCancel={() => setEditingTaskId(null)} 
        isPending={isPending}
      />
    );
  }

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between pb-2">
        <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-muted-foreground" />
          Execution Tasks
        </h4>
        <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setEditingTaskId('new')}>
          <Plus className="h-3 w-3 mr-1" /> Add Task
        </Button>
      </div>

      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6 bg-muted/10 border border-dashed rounded-md">
            No execution tasks defined yet.
          </div>
        ) : (
          tasks.map((task) => {
            return (
              <div key={task.id} className={cn(
                "group flex flex-col gap-2 p-3 border rounded-md text-sm transition-colors relative",
                task.blocked ? "bg-destructive/5 border-destructive/20" : "bg-card border-border hover:border-primary/40"
              )}>
                <div className="flex items-start justify-between gap-2 pr-6">
                  <div className="font-semibold text-sm truncate flex-1 leading-none">{task.name}</div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 -mt-1 -mr-1" onClick={() => setEditingTaskId(task.id)}>
                    <Edit className="h-3 w-3" />
                  </Button>
                </div>
                
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => {
                    if (window.confirm('Delete this task?')) onDelete(task.id);
                  }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                
                <div className="flex items-center flex-wrap gap-2 text-xs">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                    task.stage === 'Complete' ? "bg-green-100 text-green-700" :
                    task.stage === 'Ready for Review' ? "bg-blue-100 text-blue-700" :
                    task.stage === 'In Progress' ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-700"
                  )}>
                    {task.stage || 'Not Started'}
                  </span>
                  
                  {task.blocked && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      <AlertTriangle className="h-3 w-3" /> Blocked: {task.blockedReason}
                    </span>
                  )}
                  
                  {!task.blocked && task.effortPoints !== undefined && task.effortPoints > 0 && (
                    <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Effort: {task.effortPoints} pts
                    </span>
                  )}
                </div>
                
                <div className="text-[11px] text-muted-foreground flex justify-between items-center mt-1">
                  <span className="font-medium">{task.owner || 'Unassigned'}</span>
                  <span className={cn(task.dueAt ? "text-foreground" : "italic")}>
                    Due: {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'TBD'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
