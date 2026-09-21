import React, { useState } from 'react';
import {
  useGetCampaignDeliverables,
  useCreateCta,
  useUpdateCta,
  useDeleteCta,
  useCreateLandingPage,
  useUpdateLandingPage,
  useDeleteLandingPage,
  useCreateContentAsset,
  useUpdateContentAsset,
  useDeleteContentAsset,
  type Cta,
  type CtaInput,
  type LandingPageDeliverable,
  type LandingPageInput,
  type ContentAsset,
  type ContentAssetInput,
  type CampaignDeliverablesOutstandingItem,
  type DeliverableBuildStatus
} from '@workspace/api-client-react';
import { getGetCampaignDeliverablesQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Plus, Edit2, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useQueryClient } from '@tanstack/react-query';

export default function CampaignDeliverablesTab({ campaign }: { campaign: any }) {
  const { data, isLoading, error } = useGetCampaignDeliverables(campaign.id);
  
  if (isLoading) return <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (error) return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Error loading deliverables</AlertTitle>
      <AlertDescription>{error instanceof Error ? error.message : String(error)}</AlertDescription>
    </Alert>
  );
  if (!data) return null;

  return (
    <div className="space-y-8 pb-20">
      <p className="text-xs text-muted-foreground">
        “Published” below is an internal content-build status only. It does not publish externally or confer governance approval.
      </p>
      <OutstandingBlockers outstanding={data.outstanding} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CtaManager campaignId={campaign.id} ctas={data.ctas} lps={data.landingPages} />
        <LandingPageManager campaignId={campaign.id} lps={data.landingPages} assets={data.contentAssets} />
        <ContentAssetManager campaignId={campaign.id} assets={data.contentAssets} />
      </div>
    </div>
  );
}

const statusOptions: DeliverableBuildStatus[] = ['Not Started', 'Drafted', 'In Review', 'Published'];

function OutstandingBlockers({ outstanding }: { outstanding: CampaignDeliverablesOutstandingItem[] }) {
  if (!outstanding || outstanding.length === 0) return null;

  return (
    <Card className="border-destructive/50 bg-destructive/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-destructive flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" /> Outstanding Deliverables
        </CardTitle>
        <CardDescription>The following deliverables are blocking communications because they are not Published.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-sm">
            {outstanding.map((item: any, idx) => (
              <li key={idx}>
                <span className="font-semibold text-foreground">{item.name}</span>
                <span className="ml-2 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs">{item.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

function CtaManager({ campaignId, ctas, lps }: { campaignId: string, ctas: Cta[], lps: LandingPageDeliverable[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<CtaInput | null>(null);
  const create = useCreateCta();
  const update = useUpdateCta();
  const del = useDeleteCta();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleOpenEdit = (cta?: Cta) => {
    if (cta) {
      setEditingId(cta.id);
      setEditingDraft({
        name: cta.name,
        buttonText: cta.buttonText,
        owner: cta.owner,
        status: cta.status,
        publishBy: cta.publishBy,
        landingPageId: cta.landingPageId,
        destinationUrl: cta.destinationUrl,
      });
    } else {
      setEditingId('new');
      setEditingDraft({
        name: '',
        buttonText: '',
        owner: '',
        status: 'Not Started',
        publishBy: null,
        landingPageId: null,
        destinationUrl: null,
      });
    }
  };

  const handleSave = async () => {
    if (!editingDraft) return;
    
    // Validate: exactly one destination
    if (!editingDraft.landingPageId && !editingDraft.destinationUrl) {
      toast({ title: 'Validation Error', description: 'Must select either an External URL or a Landing Page', variant: 'destructive' });
      return;
    }
    if (editingDraft.landingPageId && editingDraft.destinationUrl) {
      toast({ title: 'Validation Error', description: 'Cannot select both an External URL and a Landing Page', variant: 'destructive' });
      return;
    }

    try {
      if (editingId === 'new') {
        await create.mutateAsync({ id: campaignId, data: editingDraft });
      } else if (editingId) {
        await update.mutateAsync({ id: campaignId, deliverableId: editingId, data: editingDraft });
      }
      queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
      setEditingId(null);
      setEditingDraft(null);
      toast({ title: 'CTA saved successfully' });
    } catch (err: any) {
      const msg = err?.data?.error?.message || err.message;
      toast({ title: 'Failed to save CTA', description: msg, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await del.mutateAsync({ id: campaignId, deliverableId: id });
      queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
      toast({ title: 'CTA deleted' });
    } catch (err: any) {
      const msg = err?.data?.error?.message || err.message;
      toast({ title: 'Failed to delete CTA', description: msg, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Calls to Action (CTAs)</CardTitle>
        <Button size="sm" onClick={() => handleOpenEdit()}>
          <Plus className="h-4 w-4 mr-2" /> New CTA
        </Button>
      </CardHeader>
      <CardContent>
        {ctas.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No CTAs added yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {ctas.map(cta => (
                <TableRow key={cta.id}>
                  <TableCell className="font-medium">{cta.name}</TableCell>
                  <TableCell><StatusBadge status={cta.status} /></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(cta)}><Edit2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(cta.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={!!editingId} onOpenChange={(o) => { if(!o) { setEditingId(null); setEditingDraft(null); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId === 'new' ? 'Create CTA' : 'Edit CTA'}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>Name</Label><Input value={editingDraft?.name || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, name: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Button Text</Label><Input value={editingDraft?.buttonText || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, buttonText: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Owner</Label><Input value={editingDraft?.owner || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, owner: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Status</Label>
                <Select value={editingDraft?.status || 'Not Started'} onValueChange={v => setEditingDraft(s => s ? ({ ...s, status: v as DeliverableBuildStatus }) : null)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statusOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Publish By (YYYY-MM-DD)</Label><Input type="date" value={editingDraft?.publishBy || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, publishBy: e.target.value || null }) : null)} /></div>
              
              <div className="space-y-2 pt-4 border-t"><Label>Destination (Choose exactly one)</Label>
                <div className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">External URL</Label>
                    <Input 
                      placeholder="https://" 
                      value={editingDraft?.destinationUrl || ''} 
                      onChange={e => setEditingDraft(s => s ? ({ ...s, destinationUrl: e.target.value || null, landingPageId: null }) : null)}
                      disabled={!!editingDraft?.landingPageId}
                    />
                  </div>
                  <div className="flex items-center justify-center text-xs text-muted-foreground">- OR -</div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Campaign Landing Page</Label>
                    <Select 
                      value={editingDraft?.landingPageId || 'none'} 
                      onValueChange={v => setEditingDraft(s => s ? ({ ...s, landingPageId: v === 'none' ? null : v, destinationUrl: v === 'none' ? s?.destinationUrl : null }) : null)}
                      disabled={!!editingDraft?.destinationUrl}
                    >
                      <SelectTrigger><SelectValue placeholder="Select LP" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {lps.map(lp => <SelectItem key={lp.id} value={lp.id}>{lp.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={handleSave} disabled={create.isPending || update.isPending}>{editingId === 'new' ? 'Create' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function LandingPageManager({ campaignId, lps, assets }: { campaignId: string, lps: LandingPageDeliverable[], assets: ContentAsset[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<LandingPageInput & { publishedUrl?: string | null; contentAssetIds?: string[] } | null>(null);
  const create = useCreateLandingPage();
  const update = useUpdateLandingPage();
  const del = useDeleteLandingPage();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleOpenEdit = (lp?: LandingPageDeliverable) => {
    if (lp) {
      setEditingId(lp.id);
      setEditingDraft({
        name: lp.name,
        headline: lp.headline,
        supportingCopyNeeds: lp.supportingCopyNeeds,
        personalizationRequirements: lp.personalizationRequirements,
        owner: lp.owner,
        status: lp.status,
        publishBy: lp.publishBy,
        publishedUrl: lp.publishedUrl,
        contentAssetIds: lp.contentAssetIds,
      });
    } else {
      setEditingId('new');
      setEditingDraft({
        name: '',
        headline: '',
        supportingCopyNeeds: '',
        personalizationRequirements: '',
        owner: '',
        status: 'Not Started',
        publishBy: null,
        publishedUrl: null,
        contentAssetIds: [],
      });
    }
  };

  const handleSave = async () => {
    if (!editingDraft) return;
    try {
      if (editingId === 'new') {
        await create.mutateAsync({ id: campaignId, data: editingDraft });
      } else if (editingId) {
        await update.mutateAsync({ id: campaignId, deliverableId: editingId, data: editingDraft });
      }
      queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
      setEditingId(null);
      setEditingDraft(null);
      toast({ title: 'Landing Page saved' });
    } catch (err: any) {
      const msg = err?.data?.error?.message || err.message;
      toast({ title: 'Failed to save Landing Page', description: msg, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await del.mutateAsync({ id: campaignId, deliverableId: id });
      queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
      toast({ title: 'Landing Page deleted' });
    } catch (err: any) {
      const msg = err?.data?.error?.message || err.message;
      toast({ title: 'Failed to delete LP', description: msg, variant: 'destructive' });
    }
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Landing Pages</CardTitle>
        <Button size="sm" onClick={() => handleOpenEdit()}>
          <Plus className="h-4 w-4 mr-2" /> New LP
        </Button>
      </CardHeader>
      <CardContent>
        {lps.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No Landing Pages added yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>URL</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {lps.map(lp => (
                <TableRow key={lp.id}>
                  <TableCell className="font-medium">{lp.name}</TableCell>
                  <TableCell>{lp.publishedUrl ? <a href={lp.publishedUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">{lp.publishedUrl} <ExternalLink className="h-3 w-3" /></a> : <span className="text-muted-foreground text-xs">Not published</span>}</TableCell>
                  <TableCell><StatusBadge status={lp.status} /></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(lp)}><Edit2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(lp.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={!!editingId} onOpenChange={(o) => { if (!o) { setEditingId(null); setEditingDraft(null); } }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editingId === 'new' ? 'Create Landing Page' : 'Edit Landing Page'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2"><Label>Name</Label><Input value={editingDraft?.name || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, name: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Headline</Label><Input value={editingDraft?.headline || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, headline: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Supporting Copy Needs</Label><Input value={editingDraft?.supportingCopyNeeds || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, supportingCopyNeeds: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Personalization Requirements (Brief)</Label><Input value={editingDraft?.personalizationRequirements || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, personalizationRequirements: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Owner</Label><Input value={editingDraft?.owner || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, owner: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Status</Label>
                <Select value={editingDraft?.status || 'Not Started'} onValueChange={v => setEditingDraft(s => s ? ({ ...s, status: v as DeliverableBuildStatus }) : null)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statusOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Publish By (YYYY-MM-DD)</Label><Input type="date" value={editingDraft?.publishBy || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, publishBy: e.target.value || null }) : null)} /></div>
              <div className="space-y-2"><Label>Published URL (Optional)</Label><Input value={editingDraft?.publishedUrl || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, publishedUrl: e.target.value || null }) : null)} placeholder="https://" /></div>
            </div>
            <div className="space-y-2 border-t pt-4">
              <Label>Content Asset Dependencies</Label>
              <div className="flex flex-wrap gap-2">
                {assets.map(asset => {
                  const isSelected = editingDraft?.contentAssetIds?.includes(asset.id);
                  return (
                    <Button 
                      key={asset.id} 
                      variant={isSelected ? "default" : "outline"} 
                      size="sm"
                      onClick={() => {
                        const current = editingDraft?.contentAssetIds || [];
                        setEditingDraft(s => s ? ({ ...s, contentAssetIds: isSelected ? current.filter(id => id !== asset.id) : [...current, asset.id] }) : null);
                      }}
                    >
                      {asset.name}
                    </Button>
                  );
                })}
                {assets.length === 0 && <span className="text-xs text-muted-foreground">No content assets available to link.</span>}
              </div>
            </div>
            <DialogFooter><Button onClick={handleSave} disabled={create.isPending || update.isPending}>{editingId === 'new' ? 'Create' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function ContentAssetManager({ campaignId, assets }: { campaignId: string, assets: ContentAsset[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<ContentAssetInput | null>(null);
  const create = useCreateContentAsset();
  const update = useUpdateContentAsset();
  const del = useDeleteContentAsset();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleOpenEdit = (asset?: ContentAsset) => {
    if (asset) {
      setEditingId(asset.id);
      setEditingDraft({
        name: asset.name,
        brief: asset.brief,
        owner: asset.owner,
        status: asset.status,
        publishBy: asset.publishBy,
      });
    } else {
      setEditingId('new');
      setEditingDraft({
        name: '',
        brief: '',
        owner: '',
        status: 'Not Started',
        publishBy: null,
      });
    }
  };

  const handleSave = async () => {
    if (!editingDraft) return;
    try {
      if (editingId === 'new') {
        await create.mutateAsync({ id: campaignId, data: editingDraft });
      } else if (editingId) {
        await update.mutateAsync({ id: campaignId, deliverableId: editingId, data: editingDraft });
      }
      queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
      setEditingId(null);
      setEditingDraft(null);
      toast({ title: 'Content Asset saved' });
    } catch (err: any) {
      const msg = err?.data?.error?.message || err.message;
      toast({ title: 'Failed to save Content Asset', description: msg, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await del.mutateAsync({ id: campaignId, deliverableId: id });
      queryClient.invalidateQueries({ queryKey: getGetCampaignDeliverablesQueryKey(campaignId) });
      toast({ title: 'Asset deleted' });
    } catch (err: any) {
      const msg = err?.data?.error?.message || err.message;
      toast({ title: 'Failed to delete Asset', description: msg, variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Content Assets</CardTitle>
        <Button size="sm" onClick={() => handleOpenEdit()}>
          <Plus className="h-4 w-4 mr-2" /> New Asset
        </Button>
      </CardHeader>
      <CardContent>
        {assets.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No Content Assets added yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {assets.map(asset => (
                <TableRow key={asset.id}>
                  <TableCell className="font-medium">{asset.name}</TableCell>
                  <TableCell><StatusBadge status={asset.status} /></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(asset)}><Edit2 className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(asset.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={!!editingId} onOpenChange={(o) => { if(!o) { setEditingId(null); setEditingDraft(null); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editingId === 'new' ? 'Create Content Asset' : 'Edit Content Asset'}</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label>Name</Label><Input value={editingDraft?.name || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, name: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Brief</Label><Input value={editingDraft?.brief || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, brief: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Owner</Label><Input value={editingDraft?.owner || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, owner: e.target.value }) : null)} /></div>
              <div className="space-y-2"><Label>Status</Label>
                <Select value={editingDraft?.status || 'Not Started'} onValueChange={v => setEditingDraft(s => s ? ({ ...s, status: v as DeliverableBuildStatus }) : null)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{statusOptions.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Publish By (YYYY-MM-DD)</Label><Input type="date" value={editingDraft?.publishBy || ''} onChange={e => setEditingDraft(s => s ? ({ ...s, publishBy: e.target.value || null }) : null)} /></div>
            </div>
            <DialogFooter><Button onClick={handleSave} disabled={create.isPending || update.isPending}>{editingId === 'new' ? 'Create' : 'Save'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'Not Started': 'bg-secondary text-secondary-foreground',
    'Drafted': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
    'In Review': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
    'Published': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  };
  return <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors['Not Started']}`}>{status}</span>;
}
