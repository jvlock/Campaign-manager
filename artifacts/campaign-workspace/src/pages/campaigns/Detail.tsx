import { useRoute, useLocation } from 'wouter';
import { useGetCampaign, getGetCampaignQueryKey } from '@workspace/api-client-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, ArrowLeft, Share, Download, Settings, Play } from 'lucide-react';
import { Link } from 'wouter';
import EngagementMap from '@/components/map/EngagementMap';
import { format } from 'date-fns';

export default function CampaignDetail() {
  const [match, params] = useRoute('/campaigns/:id');
  const id = params?.id;
  const { data: campaign, isLoading } = useGetCampaign(id || '', {
    query: { enabled: !!id && id !== 'new', queryKey: getGetCampaignQueryKey(id || '') }
  });

  if (!id || id === 'new') return null;

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!campaign) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Campaign not found.</div>;
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card shrink-0 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/campaigns" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Campaigns
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">{campaign.name}</span>
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{campaign.name}</h1>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-xs">
                {campaign.lifecycle}
              </span>
              <span>{campaign.scope}</span>
              <span>&middot;</span>
              <span>{campaign.audience}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Share className="h-4 w-4 mr-2" /> Share
            </Button>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
            <Button size="sm">
              <Play className="h-4 w-4 mr-2" /> Simulate
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="map" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 border-b border-border bg-card shrink-0">
          <TabsList className="bg-transparent h-12 p-0 gap-6">
            <TabsTrigger 
              value="strategy" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-12 px-0"
            >
              Strategy
            </TabsTrigger>
            <TabsTrigger 
              value="map" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-12 px-0"
            >
              Engagement Map
            </TabsTrigger>
            <TabsTrigger 
              value="calendar" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-12 px-0"
            >
              Calendar
            </TabsTrigger>
            <TabsTrigger 
              value="delivery" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-12 px-0"
            >
              Delivery & UTMs
            </TabsTrigger>
            <TabsTrigger 
              value="presentation" 
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-12 px-0"
            >
              Presentation
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto bg-muted/20 relative">
          <TabsContent value="strategy" className="m-0 h-full p-6 max-w-4xl mx-auto space-y-8">
            <div className="space-y-6">
               <h2 className="text-xl font-semibold">Strategic Brief</h2>
               <div className="grid gap-6 md:grid-cols-2">
                 <div className="space-y-1">
                   <h3 className="text-sm font-medium text-muted-foreground">Outcome</h3>
                   <p className="text-base">{campaign.outcome}</p>
                 </div>
                 <div className="space-y-1">
                   <h3 className="text-sm font-medium text-muted-foreground">Target Audience</h3>
                   <p className="text-base">{campaign.audience}</p>
                 </div>
               </div>
            </div>
          </TabsContent>
          
          <TabsContent value="map" className="m-0 h-full p-4">
            <EngagementMap campaign={campaign} />
          </TabsContent>
          
          <TabsContent value="calendar" className="m-0 h-full p-6 flex items-center justify-center text-muted-foreground">
            Calendar View (Stub)
          </TabsContent>

          <TabsContent value="delivery" className="m-0 h-full p-6 max-w-5xl mx-auto">
            <h2 className="text-xl font-semibold mb-6">UTM Links & Tracking</h2>
            <div className="rounded-md border border-border bg-card overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Destination</th>
                    <th className="px-4 py-3">Generated URL</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {campaign.utmLinks.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">No UTM links generated yet.</td>
                    </tr>
                  ) : (
                    campaign.utmLinks.map(link => (
                      <tr key={link.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 truncate max-w-[200px]" title={link.destinationUrl}>{link.destinationUrl}</td>
                        <td className="px-4 py-3 font-mono text-xs truncate max-w-[300px] text-muted-foreground" title={link.fullUrl}>{link.fullUrl}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">{link.status}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="presentation" className="m-0 h-full p-6 flex items-center justify-center text-muted-foreground">
            Presentation View (Stub)
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
