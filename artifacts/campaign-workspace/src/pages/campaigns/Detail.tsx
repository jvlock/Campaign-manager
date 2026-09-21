import { useRoute, useLocation, useSearch } from 'wouter';
import { useGetCampaign, useUpdateCampaign, getGetCampaignQueryKey, exportCampaign } from '@workspace/api-client-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft, Share, Download, Play, Save, CheckCircle2 } from 'lucide-react';
import { Link } from 'wouter';
import EngagementMap from '@/components/map/EngagementMap';
import CampaignDeliveryTab from './CampaignDeliveryTab';
import CampaignDeliverablesTab from './CampaignDeliverablesTab';
import { useEffect, useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export default function CampaignDetail() {
  const [match, params] = useRoute('/campaigns/:id');
  const search = useSearch();
  const [_, setLocation] = useLocation();
  const id = params?.id;
  const { data: campaign, isLoading } = useGetCampaign(id || '', {
    query: { enabled: !!id && id !== 'new', queryKey: getGetCampaignQueryKey(id || '') }
  });

  const searchParams = new URLSearchParams(search);
  const tabFromUrl = searchParams.get('tab') || 'map';
  const activityFromUrl = searchParams.get('activity');

  const [activeTab, setActiveTab] = useState(tabFromUrl);
  const updateCampaign = useUpdateCampaign();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [strategyDraft, setStrategyDraft] = useState<Record<string, string>>({});
  const [inheritanceDraft, setInheritanceDraft] = useState<Record<string, string>>({});
  const [isSavingStrategy, setIsSavingStrategy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const strategyInitializedForId = useRef<string | null>(null);

  useEffect(() => {
    if (campaign && campaign.id !== strategyInitializedForId.current) {
      setStrategyDraft(campaign.strategy as Record<string, string> || {});
      const inherited = (campaign.inheritance || {}) as Record<string, unknown>;
      setInheritanceDraft({
        deliveryStartDate: String(inherited.deliveryStartDate ?? ''),
        deliveryEndDate: String(inherited.deliveryEndDate ?? ''),
        productValueIds: Array.isArray(inherited.productValueIds) ? inherited.productValueIds.join(', ') : '',
        owner: String(inherited.owner ?? ''),
        region: String(inherited.region ?? ''),
        language: String(inherited.language ?? ''),
        primaryCta: String(inherited.primaryCta ?? ''),
        landingDestination: String(inherited.landingDestination ?? ''),
      });
      strategyInitializedForId.current = campaign.id;
    }
  }, [campaign]);

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl, activeTab]);

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    const params = new URLSearchParams(search);
    params.set('tab', val);
    setLocation(`/campaigns/${id}?${params.toString()}`);
  };

  const saveStrategy = () => {
    if (!campaign) return;
    setIsSavingStrategy(true);
    updateCampaign.mutate({
      id: campaign.id,
      data: {
        rowVersion: Number((campaign as any).rowVersion ?? 1),
        strategy: strategyDraft,
        inheritance: {
          deliveryStartDate: inheritanceDraft.deliveryStartDate || null,
          deliveryEndDate: inheritanceDraft.deliveryEndDate || null,
          productValueIds: inheritanceDraft.productValueIds
            ? inheritanceDraft.productValueIds.split(/[,\n]/).map((value) => value.trim()).filter(Boolean)
            : null,
          owner: inheritanceDraft.owner || null,
          region: inheritanceDraft.region || null,
          language: inheritanceDraft.language || null,
          primaryCta: inheritanceDraft.primaryCta || null,
          landingDestination: inheritanceDraft.landingDestination || null,
        }
      }
    }, {
      onSuccess: () => {
        setIsSavingStrategy(false);
        queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(campaign.id) });
        toast({ title: 'Strategy saved' });
      },
      onError: (err) => {
        setIsSavingStrategy(false);
        toast({ title: 'Failed to save strategy', variant: 'destructive' });
      }
    });
  };

  const downloadProvisionalDraft = async () => {
    if (!campaign) return;
    setIsExporting(true);
    try {
      const exported = await exportCampaign(campaign.id, 'json');
      const content = typeof exported === 'string' ? exported : JSON.stringify(exported, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `campaign-${campaign.id}-provisional-draft.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast({
        title: 'Provisional draft downloaded',
        description: 'This local file is not governance-approved and cannot be externally published.',
      });
    } catch (error) {
      toast({
        title: 'Draft download failed',
        description: error instanceof Error ? error.message : 'The provisional draft could not be downloaded.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (!id || id === 'new') return null;

  if (isLoading) {
    return <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!campaign) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground">Campaign not found.</div>;
  }

  const rowVersion = Number((campaign as any).rowVersion ?? 1);

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
               <span className="text-[11px] text-muted-foreground/70" title="Concurrency version">
                 v{rowVersion}
               </span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Share className="h-4 w-4 mr-2" /> Share
            </Button>
            <Button variant="outline" size="sm" onClick={() => void downloadProvisionalDraft()} disabled={isExporting}>
              {isExporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Download provisional draft
            </Button>
            <Button size="sm">
              <Play className="h-4 w-4 mr-2" /> Simulate
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="flex-1 flex flex-col overflow-hidden">
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
              value="deliverables"
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none h-12 px-0"
            >
              Deliverables
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
          <TabsContent value="strategy" className="m-0 h-full p-6 max-w-4xl mx-auto space-y-8 overflow-y-auto pb-20">
            <div className="space-y-6">
               <div className="flex items-center justify-between">
                 <h2 className="text-xl font-semibold">Strategic Brief</h2>
                 <Button onClick={saveStrategy} disabled={isSavingStrategy || !campaign}>
                   {isSavingStrategy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                   Save Strategy
                 </Button>
               </div>

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

               <div className="pt-6 border-t border-border space-y-6">
                 <h3 className="text-lg font-medium">Campaign Defaults</h3>
                 <p className="text-sm text-muted-foreground">
                    Activities inherit these governed defaults unless an activity explicitly overrides or clears a value.
                 </p>

                 <div className="grid gap-4 sm:grid-cols-2">
                   <div className="space-y-2">
                      <Label>Delivery start date</Label>
                      <Input
                        type="date"
                        value={inheritanceDraft.deliveryStartDate || ''}
                        onChange={(e) => setInheritanceDraft((draft) => ({ ...draft, deliveryStartDate: e.target.value }))}
                     />
                   </div>
                   <div className="space-y-2">
                      <Label>Delivery end date</Label>
                      <Input
                        type="date"
                        value={inheritanceDraft.deliveryEndDate || ''}
                        onChange={(e) => setInheritanceDraft((draft) => ({ ...draft, deliveryEndDate: e.target.value }))}
                     />
                   </div>
                   <div className="space-y-2">
                      <Label>Product value IDs</Label>
                      <Input
                        value={inheritanceDraft.productValueIds || ''}
                        onChange={(e) => setInheritanceDraft((draft) => ({ ...draft, productValueIds: e.target.value }))}
                        placeholder="Comma-separated IDs"
                     />
                   </div>
                   <div className="space-y-2">
                      <Label>Owner</Label>
                      <Input
                        value={inheritanceDraft.owner || ''}
                        onChange={(e) => setInheritanceDraft((draft) => ({ ...draft, owner: e.target.value }))}
                     />
                   </div>
                    {[
                      ['region', 'Region'],
                      ['language', 'Language'],
                      ['primaryCta', 'Primary CTA'],
                      ['landingDestination', 'Landing destination'],
                    ].map(([key, label]) => (
                      <div key={key} className="space-y-2">
                        <Label>{label}</Label>
                        <Input
                          value={inheritanceDraft[key] || ''}
                          onChange={(event) => setInheritanceDraft((draft) => ({ ...draft, [key]: event.target.value }))}
                        />
                      </div>
                    ))}
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

          <TabsContent value="deliverables" className="m-0 h-full p-6 max-w-7xl mx-auto overflow-y-auto">
            <CampaignDeliverablesTab campaign={campaign} />
          </TabsContent>

          <TabsContent value="delivery" className="m-0 h-full p-6 max-w-7xl mx-auto overflow-y-auto">
            <CampaignDeliveryTab campaign={campaign} />
          </TabsContent>

          <TabsContent value="presentation" className="m-0 h-full p-6 flex items-center justify-center text-muted-foreground">
            Presentation View (Stub)
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
