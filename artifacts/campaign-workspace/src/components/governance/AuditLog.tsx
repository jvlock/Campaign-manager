import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, User, Loader2 } from 'lucide-react';
import { useListGovernanceAudit } from '@workspace/api-client-react';

export default function AuditLog() {
  const { data: auditData, isLoading } = useListGovernanceAudit();

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardHeader><CardTitle>Audit Log</CardTitle></CardHeader>
        <CardContent className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }

  const logs = auditData || [];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Audit Log</CardTitle>
        <CardDescription>Recent governance actions and system events.</CardDescription>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4 border border-dashed rounded-md">No audit logs found.</div>
        ) : (
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-4">
              {logs.map((log: any) => (
                <div key={log.id} className="relative pl-6 pb-4 last:pb-0 border-l border-border last:border-transparent">
                  <div className="absolute left-[-5px] top-1 h-2.5 w-2.5 rounded-full bg-muted-foreground border-2 border-card" />
                  <div className="text-sm font-medium">{log.action}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    <span className="font-medium">Reason:</span> {log.reason}
                  </div>
                  {(log.before !== undefined || log.after !== undefined) && (
                    <div className="mt-2 grid gap-2 text-[10px] sm:grid-cols-2">
                      <div className="rounded border border-border bg-muted/20 p-2">
                        <div className="font-semibold text-muted-foreground mb-1">Before</div>
                        <code className="break-all">{log.before == null ? '—' : JSON.stringify(log.before)}</code>
                      </div>
                      <div className="rounded border border-border bg-muted/20 p-2">
                        <div className="font-semibold text-muted-foreground mb-1">After</div>
                        <code className="break-all">{log.after == null ? '—' : JSON.stringify(log.after)}</code>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><User className="h-3 w-3" /> Recorded by (self-declared): {log.actor}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(log.createdAt).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
