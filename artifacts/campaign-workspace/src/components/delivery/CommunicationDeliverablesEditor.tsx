import React, { useState } from 'react';
import { 
  useGetCampaignDeliverables, 
  useUpdateCommunicationDeliverableDependencies,
  useReleaseCommunication,
  useCreateAndAttachCta,
  useCreateAndAttachLandingPage,
  getGetCampaignDeliverablesQueryKey,
  getGetCampaignDeliveryQueryKey
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, AlertTriangle, Link2, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

export function CommunicationDeliverablesEditor({ 
  campaignId, 
  communicationId 
}: { 
  campaignId: string, 
  communicationId: string 
}) {
  const { data, isLoading } = useGetCampaignDeliverables(campaignId);
  const updateDependencies = useUpdateCommunicationDeliverableDependencies();
  const release = useReleaseCommunication();
  const createCta = useCreateAndAttachCta();
  const createLp = useCreateAndAttachLandingPage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newCtaOpen, setNewCtaOpen] = useState(false);
  const [newLpOpen, setNewLpOpen] = useState(false);
  
  // CTA Quick Draft
  const [ctaDraft, setCtaDraft] = useState<{
    name: string;
    buttonText: string;
    destinationType: 'url' | 'lp';
    destinationUrl: string | null;
    landingPageId: string | null;
  }>({ name: '', buttonText: 'Click Here', destinationType: 'url', destinationUrl: '', landingPageId: null });

  // LP Quick Draft
  const [lpDraft, setLpDraft] = useState<{
    name: string;
    headline: string;
    supportingCopyNeeds: string;
    personalizationRequirements: string;
    owner: string;
    publishedUrl: string | null;
  }>({ name: '', headline: '', supportingCopyNeeds: '', personalizationRequirements: '', owner: 'Campaign team', publishedUrl: null });

  if (isLoading) return <div className="py-4 text-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground mx-auto" /></div>;
  if (!data) return null;

  const readiness = data.communications.find(c => c.communicationId === communicationId);
  
  // If this communication isn't tracked yet in readiness rows, we just fallback gracefully.
  if (!readiness) return null;

  const invalidateQueries = () => {
    queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
    queryClient.invalidateQueries({ queryKey: getGetCampaignDeliveryQueryKey(campaignId) });
    // Keep 'campaign' query if needed, but above handles delivery and deliverables
  };

  const handleToggleCta = async (ctaId: string) => {
    try {
      const current = new Set(readiness.ctaIds);
      if (current.has(ctaId)) current.delete(ctaId);
      else current.add(ctaId);
      
      await updateDependencies.mutateAsync({
        id: campaignId,
        itemId: communicationId,
        data: { ctaIds: Array.from(current), landingPageIds: readiness.landingPageIds }
      });
      invalidateQueries();
      toast({ title: 'Dependencies updated' });
    } catch (err: any) {
      toast({ title: 'Update failed', description: err?.data?.error?.message || err.message, variant: 'destructive' });
    }
  };

  const handleToggleLp = async (lpId: string) => {
    try {
      const current = new Set(readiness.landingPageIds);
      if (current.has(lpId)) current.delete(lpId);
      else current.add(lpId);
      
      await updateDependencies.mutateAsync({
        id: campaignId,
        itemId: communicationId,
        data: { ctaIds: readiness.ctaIds, landingPageIds: Array.from(current) }
      });
      invalidateQueries();
      toast({ title: 'Dependencies updated' });
    } catch (err: any) {
      toast({ title: 'Update failed', description: err?.data?.error?.message || err.message, variant: 'destructive' });
    }
  };

  const handleRelease = async () => {
    try {
      await release.mutateAsync({ id: campaignId, itemId: communicationId });
      invalidateQueries();
      toast({ title: 'Communication marked as released', description: 'No emails were sent. This only updates planning readiness.' });
    } catch (err: any) {
      toast({ title: 'Release failed', description: err?.data?.error?.message || err.message, variant: 'destructive' });
    }
  };

  const handleQuickCreateCta = async () => {
    if (ctaDraft.destinationType === 'url' && !ctaDraft.destinationUrl) {
      toast({ title: 'Validation Error', description: 'Destination URL is required when selected.', variant: 'destructive' });
      return;
    }
    if (ctaDraft.destinationType === 'lp' && !ctaDraft.landingPageId) {
      toast({ title: 'Validation Error', description: 'Landing Page is required when selected.', variant: 'destructive' });
      return;
    }

    try {
      await createCta.mutateAsync({
        id: campaignId,
        itemId: communicationId,
        data: {
          name: ctaDraft.name,
          buttonText: ctaDraft.buttonText,
          destinationUrl: ctaDraft.destinationType === 'url' ? ctaDraft.destinationUrl : null,
          landingPageId: ctaDraft.destinationType === 'lp' ? ctaDraft.landingPageId : null,
          owner: 'Campaign team',
          status: 'Not Started'
        }
      });
      invalidateQueries();
      setNewCtaOpen(false);
      setCtaDraft({ name: '', buttonText: 'Click Here', destinationType: 'url', destinationUrl: '', landingPageId: null });
      toast({ title: 'CTA created and linked' });
    } catch (err: any) {
      toast({ title: 'Failed to create and link CTA', description: err?.data?.error?.message || err.message, variant: 'destructive' });
    }
  };

  const handleQuickCreateLp = async () => {
    try {
      await createLp.mutateAsync({
        id: campaignId,
        itemId: communicationId,
        data: {
          name: lpDraft.name,
          headline: lpDraft.headline || lpDraft.name,
          supportingCopyNeeds: lpDraft.supportingCopyNeeds,
          personalizationRequirements: lpDraft.personalizationRequirements,
          owner: lpDraft.owner || 'Campaign team',
          status: 'Not Started'
        }
      });
      invalidateQueries();
      setNewLpOpen(false);
      setLpDraft({ name: '', headline: '', supportingCopyNeeds: '', personalizationRequirements: '', owner: 'Campaign team', publishedUrl: null });
      toast({ title: 'Landing Page created and linked' });
    } catch (err: any) {
      toast({ title: 'Failed to create and link LP', description: err?.data?.error?.message || err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 pt-4 border-t border-border mt-4">
      <div className="flex justify-between items-start">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" /> Deliverable Dependencies
        </h4>
        <div className="text-right flex flex-col items-end gap-2">
          {readiness.dependencyReadiness === 'Ready' ? (
            <div className="flex items-center gap-1 text-emerald-600 text-xs font-medium">
              <CheckCircle2 className="h-4 w-4" /> Ready for Release
            </div>
          ) : (
            <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
              <AlertTriangle className="h-4 w-4" /> Blocked by unpublished dependencies
            </div>
          )}
          
          <Button 
            size="sm" 
            variant={readiness.releaseState === 'Released' ? 'outline' : 'default'}
            disabled={readiness.dependencyReadiness !== 'Ready' || readiness.releaseState === 'Released' || release.isPending}
            onClick={handleRelease}
            className="h-7 text-xs"
          >
            {release.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
            {readiness.releaseState === 'Released' ? 'Released' : 'Mark Released'}
          </Button>
          {readiness.releaseState === 'Released' && readiness.releasedAt && (
            <div className="text-[10px] text-muted-foreground">at {new Date(readiness.releasedAt).toLocaleString()}</div>
          )}
          {readiness.externalSending === false && readiness.releaseState === 'Released' && (
            <div className="text-[10px] text-muted-foreground">External sending: OFF</div>
          )}
        </div>
      </div>
      
      {readiness.blockers.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 p-2 rounded-md text-xs">
          <span className="font-semibold">Blockers:</span> {readiness.blockers.map(b => b.name).join(', ')}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">Linked CTAs</Label>
            <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => setNewCtaOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Quick Create
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.ctas.map(cta => {
              const isSelected = readiness.ctaIds.includes(cta.id);
              return (
                <Button 
                  key={cta.id} 
                  variant={isSelected ? "default" : "outline"} 
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleToggleCta(cta.id)}
                  disabled={updateDependencies.isPending}
                >
                  {cta.name}
                </Button>
              );
            })}
            {data.ctas.length === 0 && <span className="text-[10px] text-muted-foreground italic">No CTAs in campaign</span>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-muted-foreground">Linked Landing Pages</Label>
            <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => setNewLpOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Quick Create
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.landingPages.map(lp => {
              const isSelected = readiness.landingPageIds.includes(lp.id);
              return (
                <Button 
                  key={lp.id} 
                  variant={isSelected ? "default" : "outline"} 
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => handleToggleLp(lp.id)}
                  disabled={updateDependencies.isPending}
                >
                  {lp.name}
                </Button>
              );
            })}
            {data.landingPages.length === 0 && <span className="text-[10px] text-muted-foreground italic">No LPs in campaign</span>}
          </div>
        </div>
      </div>

      {/* Quick Create CTA Dialog */}
      <Dialog open={newCtaOpen} onOpenChange={(o) => { if (!o) { setNewCtaOpen(false); setCtaDraft({ name: '', buttonText: 'Click Here', destinationType: 'url', destinationUrl: '', landingPageId: null }); }}}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quick Create & Link CTA</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Name</Label><Input value={ctaDraft.name} onChange={e => setCtaDraft(s => ({ ...s, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Button Text</Label><Input value={ctaDraft.buttonText} onChange={e => setCtaDraft(s => ({ ...s, buttonText: e.target.value }))} /></div>
            
            <div className="space-y-2 pt-2 border-t border-border">
              <Label>Destination (Choose exactly one)</Label>
              <Select value={ctaDraft.destinationType} onValueChange={(v: 'url' | 'lp') => setCtaDraft(s => ({ ...s, destinationType: v, destinationUrl: v === 'url' ? s.destinationUrl : null, landingPageId: v === 'lp' ? s.landingPageId : null }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="url">External URL</SelectItem>
                  <SelectItem value="lp">Campaign Landing Page</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {ctaDraft.destinationType === 'url' && (
              <div className="space-y-2">
                <Label>URL</Label>
                <Input placeholder="https://" value={ctaDraft.destinationUrl || ''} onChange={e => setCtaDraft(s => ({ ...s, destinationUrl: e.target.value || null }))} />
              </div>
            )}
            
            {ctaDraft.destinationType === 'lp' && (
              <div className="space-y-2">
                <Label>Select Landing Page</Label>
                <Select value={ctaDraft.landingPageId || 'none'} onValueChange={v => setCtaDraft(s => ({ ...s, landingPageId: v === 'none' ? null : v }))}>
                  <SelectTrigger><SelectValue placeholder="Select LP" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {data.landingPages.map(lp => <SelectItem key={lp.id} value={lp.id}>{lp.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <p className="text-[10px] text-muted-foreground">CTA will be created as "Not Started" and assigned to "Campaign team". It will be instantly linked to this communication.</p>
          </div>
          <DialogFooter><Button onClick={handleQuickCreateCta} disabled={!ctaDraft.name || !ctaDraft.buttonText || createCta.isPending}>Create & Link</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Create LP Dialog */}
      <Dialog open={newLpOpen} onOpenChange={(o) => { if (!o) { setNewLpOpen(false); setLpDraft({ name: '', headline: '', supportingCopyNeeds: '', personalizationRequirements: '', owner: 'Campaign team', publishedUrl: null }); }}}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Quick Create & Link Landing Page</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2"><Label>Name</Label><Input value={lpDraft.name} onChange={e => setLpDraft(s => ({ ...s, name: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Headline</Label><Input value={lpDraft.headline} onChange={e => setLpDraft(s => ({ ...s, headline: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Supporting Copy Needs</Label><Input value={lpDraft.supportingCopyNeeds} onChange={e => setLpDraft(s => ({ ...s, supportingCopyNeeds: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Personalization Requirements (Brief)</Label><Input value={lpDraft.personalizationRequirements} onChange={e => setLpDraft(s => ({ ...s, personalizationRequirements: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Owner</Label><Input value={lpDraft.owner} onChange={e => setLpDraft(s => ({ ...s, owner: e.target.value }))} /></div>
            <div className="space-y-2"><Label>Published URL (Optional)</Label><Input value={lpDraft.publishedUrl || ''} onChange={e => setLpDraft(s => ({ ...s, publishedUrl: e.target.value || null }))} placeholder="https://" /></div>
          </div>
          <p className="text-[10px] text-muted-foreground">Landing Page will be created as "Not Started". It will be instantly linked to this communication.</p>
          <DialogFooter><Button onClick={handleQuickCreateLp} disabled={!lpDraft.name || createLp.isPending}>Create & Link</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}