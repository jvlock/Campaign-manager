import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useListCampaigns, useGetPortfolio } from '@workspace/api-client-react';
import { Loader2, Plus, ArrowRight, Activity, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export default function Home() {
  const { data: campaigns, isLoading: isCampaignsLoading } = useListCampaigns();
  const { data: portfolio, isLoading: isPortfolioLoading } = useGetPortfolio();

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10 space-y-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          Welcome to the Campaign Operating Workspace. Manage your audience engagement model.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Campaigns</CardTitle>
          </CardHeader>
          <CardContent>
            {isCampaignsLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-3xl font-bold">{campaigns?.length || 0}</div>
            )}
          </CardContent>
        </Card>
        
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Identified Conflicts</CardTitle>
          </CardHeader>
          <CardContent>
            {isPortfolioLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="flex items-center gap-2">
                <div className="text-3xl font-bold">{portfolio?.conflicts.length || 0}</div>
                {portfolio && portfolio.conflicts.length > 0 && (
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Link href="/campaigns/new">
              <Button size="sm" className="w-full justify-start" variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                New Campaign
              </Button>
            </Link>
            <Link href="/portfolio">
              <Button size="sm" className="w-full justify-start" variant="outline">
                <Activity className="h-4 w-4 mr-2" />
                Review Portfolio
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Recent Campaigns</CardTitle>
            <CardDescription>Your recently updated campaigns</CardDescription>
          </CardHeader>
          <CardContent>
            {isCampaignsLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !campaigns?.length ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No campaigns found. <Link href="/campaigns/new" className="text-primary hover:underline">Create one</Link>.
              </div>
            ) : (
              <div className="space-y-4">
                {campaigns.slice(0, 5).map(c => (
                  <Link key={c.id} href={`/campaigns/${c.id}`}>
                    <div className="flex items-center justify-between p-3 rounded-lg border border-transparent hover:border-border hover:bg-muted/50 transition-colors cursor-pointer group">
                      <div>
                        <div className="font-medium text-sm group-hover:text-primary transition-colors">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.scope} &middot; {c.audience}</div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(c.updatedAt), 'MMM d, yyyy')}
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Portfolio Readiness</CardTitle>
            <CardDescription>Overall alignment and conflict status</CardDescription>
          </CardHeader>
          <CardContent>
             {isPortfolioLoading ? (
               <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
             ) : !portfolio ? (
               <div className="text-center py-8 text-sm text-muted-foreground">
                 Unable to load portfolio.
               </div>
             ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Total Campaigns</span>
                      <span className="text-muted-foreground">{portfolio.campaigns.length}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                     <h4 className="text-sm font-medium border-b pb-2">Active Conflicts</h4>
                     {portfolio.conflicts.length === 0 ? (
                       <div className="text-sm text-muted-foreground py-2">All clear. No conflicts detected.</div>
                     ) : (
                       <div className="space-y-3 pt-2">
                         {portfolio.conflicts.slice(0, 3).map(conflict => (
                           <div key={conflict.id} className="flex gap-3 text-sm">
                             <AlertTriangle className={cn(
                               "h-4 w-4 shrink-0 mt-0.5",
                               conflict.severity === 'high' ? 'text-destructive' : 'text-amber-500'
                             )} />
                             <div>
                               <div className="font-medium">{conflict.title}</div>
                               <div className="text-muted-foreground text-xs mt-1">{conflict.reason}</div>
                             </div>
                           </div>
                         ))}
                         {portfolio.conflicts.length > 3 && (
                           <Link href="/portfolio" className="text-xs text-primary font-medium hover:underline block pt-2">
                             View all {portfolio.conflicts.length} conflicts
                           </Link>
                         )}
                       </div>
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
