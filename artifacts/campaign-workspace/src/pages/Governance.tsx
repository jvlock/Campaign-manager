import { useGetGovernance, useGetAdapterStatus } from '@workspace/api-client-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Database, Code, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Governance() {
  const { data: governance, isLoading: isGovLoading } = useGetGovernance();
  const { data: adapters, isLoading: isAdaptersLoading } = useGetAdapterStatus();

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10 space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Governance</h1>
        <p className="text-muted-foreground">
          Taxonomy, naming conventions, and system integrations.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              Taxonomy & Terms
            </CardTitle>
            <CardDescription>Version {governance?.version || '...'}</CardDescription>
          </CardHeader>
          <CardContent>
            {isGovLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !governance ? (
              <div className="text-sm text-muted-foreground">No governance data found.</div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold mb-3">Activity Types</h4>
                  <div className="flex flex-wrap gap-2">
                    {governance.activityTypes.map(t => (
                      <span key={t} className="px-2.5 py-1 rounded-md bg-secondary/10 text-secondary text-xs font-medium border border-secondary/20">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-3">Taxonomy Rules</h4>
                  <div className="space-y-2">
                    {governance.taxonomyTerms.map((term, i) => (
                      <div key={i} className="flex flex-col gap-1 p-3 rounded border border-border bg-muted/30">
                        {Object.entries(term).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-sm">
                            <span className="text-muted-foreground font-mono text-xs">{k}</span>
                            <span className="font-medium">{v}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold mb-3">Naming Examples</h4>
                  <ul className="space-y-1.5 text-sm font-mono bg-muted p-3 rounded text-muted-foreground text-xs">
                    {governance.namingExamples.map((ex, i) => (
                      <li key={i}>{ex}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              Adapter Status
            </CardTitle>
            <CardDescription>Downstream platform sync health</CardDescription>
          </CardHeader>
          <CardContent>
            {isAdaptersLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !adapters ? (
              <div className="text-sm text-muted-foreground">No adapter data found.</div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Database className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium">Airtable Source</div>
                      <div className="text-xs text-muted-foreground">Master record sync</div>
                    </div>
                  </div>
                  {adapters.airtable.status === 'connected' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                <div className="p-4 rounded-lg border border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center">
                      <Code className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <div className="font-medium">AI Generation</div>
                      <div className="text-xs text-muted-foreground">Content model service</div>
                    </div>
                  </div>
                  {adapters.ai.status === 'ready' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
