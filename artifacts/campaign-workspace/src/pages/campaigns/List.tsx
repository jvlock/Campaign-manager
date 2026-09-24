import { Link } from 'wouter';
import { useListCampaigns } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, Search, Filter } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';

export default function CampaignList() {
  const { data: campaigns, isLoading, error, refetch } = useListCampaigns();
  const [search, setSearch] = useState('');

  const filtered = campaigns?.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.audience.toLowerCase().includes(search.toLowerCase()) ||
    c.scope.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="flex-1 overflow-auto p-6 md:p-10 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground">Manage and orchestrate all active campaigns.</p>
        </div>
        <Link href="/campaigns/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Campaign
          </Button>
        </Link>
      </div>

      <div className="flex items-center gap-4 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search campaigns..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="icon" className="shrink-0">
          <Filter className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <div role="alert" className="rounded border border-destructive p-4">
          <p>{error instanceof Error ? error.message : 'Unable to load campaigns. Planning access could not be confirmed.'}</p>
          <Button variant="outline" onClick={() => void refetch()}>Retry</Button>
        </div>
      ) : isLoading ? (
        <div className="py-12 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed rounded-lg bg-muted/20">
          <p className="text-muted-foreground mb-4">No campaigns found.</p>
          {search ? (
            <Button variant="outline" onClick={() => setSearch('')}>Clear search</Button>
          ) : (
            <Link href="/campaigns/new"><Button>Create your first campaign</Button></Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-12 gap-4 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <div className="col-span-12 md:col-span-4">Name</div>
            <div className="hidden md:block md:col-span-2">Scope & Region</div>
            <div className="hidden md:block md:col-span-2">Audience</div>
            <div className="hidden md:block md:col-span-2">Readiness</div>
            <div className="hidden md:block md:col-span-2 text-right">Updated</div>
          </div>
          {filtered.map(campaign => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
              <Card className="shadow-sm hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="p-4 grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-12 md:col-span-4">
                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{campaign.name}</h3>
                    <p className="text-xs text-muted-foreground md:hidden mt-1">{campaign.scope} &middot; {campaign.audience}</p>
                  </div>
                  <div className="hidden md:block md:col-span-2 text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">{campaign.scope}</div>
                    <div className="text-xs">{campaign.region}</div>
                  </div>
                  <div className="hidden md:block md:col-span-2 text-sm text-muted-foreground">
                    {campaign.audience}
                  </div>
                  <div className="hidden md:block md:col-span-2 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary rounded-full transition-all" 
                          style={{ width: `${campaign.readiness}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium">{campaign.readiness}%</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 capitalize">{campaign.lifecycle}</div>
                  </div>
                  <div className="hidden md:block md:col-span-2 text-right text-sm text-muted-foreground">
                    {format(new Date(campaign.updatedAt), 'MMM d, yyyy')}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
