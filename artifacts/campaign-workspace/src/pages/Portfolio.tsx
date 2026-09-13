import { useGetPortfolio, useRunConflictDetection } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, Play, RefreshCw, BarChart2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { getGetPortfolioQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export default function Portfolio() {
  const { data: portfolio, isLoading } = useGetPortfolio();
  const runDetection = useRunConflictDetection();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleRunDetection = () => {
    runDetection.mutate(undefined, {
      onSuccess: () => {
        toast({ title: 'Conflict detection completed' });
        queryClient.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
      },
      onError: () => {
        toast({ title: 'Failed to run detection', variant: 'destructive' });
      }
    });
  };

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Portfolio</h1>
          <p className="text-muted-foreground">
            Cross-campaign readiness and audience conflict center.
          </p>
        </div>
        <Button 
          onClick={handleRunDetection} 
          disabled={runDetection.isPending}
          className="shrink-0"
        >
          {runDetection.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          Run Conflict Detection
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : !portfolio ? (
        <div className="text-center py-12 text-muted-foreground">No portfolio data found.</div>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-6 md:grid-cols-4">
            {Object.entries(portfolio.summary).map(([key, value]) => (
              <Card key={key} className="shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="shadow-sm border-destructive/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Audience Conflicts ({portfolio.conflicts.length})
              </CardTitle>
              <CardDescription>Overlapping activities targeting the same audience simultaneously</CardDescription>
            </CardHeader>
            <CardContent>
              {portfolio.conflicts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed border-border">
                  <CheckCircle2 className="h-8 w-8 text-green-500 mb-3" />
                  <p className="font-medium text-foreground">No conflicts detected</p>
                  <p className="text-sm mt-1">Audiences and schedules are clear across the portfolio.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {portfolio.conflicts.map(conflict => (
                    <div key={conflict.id} className="p-4 rounded-lg border border-border flex flex-col md:flex-row gap-4 justify-between bg-card hover:border-destructive/30 transition-colors">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider",
                            conflict.severity === 'high' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-600'
                          )}>
                            {conflict.severity}
                          </span>
                          <h4 className="font-semibold">{conflict.title}</h4>
                        </div>
                        <p className="text-sm text-muted-foreground">{conflict.reason}</p>
                        
                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs pt-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">Campaigns:</span>
                            {conflict.campaigns.map(c => (
                              <span key={c} className="px-1.5 py-0.5 bg-muted rounded">{c}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">Dates:</span>
                            <span className="text-muted-foreground">{conflict.dates}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="md:w-64 shrink-0 space-y-3 bg-muted/40 p-3 rounded-md border border-border/50">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground mb-1">Recommendation</div>
                          <div className="text-sm">{conflict.recommendation}</div>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-muted-foreground">Owner: {conflict.owner}</span>
                          <span className="capitalize font-medium px-2 py-0.5 bg-background rounded border border-border shadow-sm">{conflict.status}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
