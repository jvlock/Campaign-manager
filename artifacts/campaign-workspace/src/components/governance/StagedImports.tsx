import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, AlertTriangle, FileJson, ArrowRight, Loader2, Upload, Search } from 'lucide-react';
import {
  TaxonomyImportCandidate,
  useListGovernanceTerms,
  useGetTaxonomyImport,
  useReviewTaxonomyImportCandidate,
  useCommitTaxonomyImport,
  useStageTaxonomyImport,
  getGetTaxonomyImportQueryOptions,
  getListGovernanceTermsQueryKey,
  TaxonomyImportReviewStatus,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type ImportCandidate = TaxonomyImportCandidate & {
  id: string;
  status?: string;
  payload?: Record<string, unknown>;
  conflicts?: string[];
  conflictType?: string | null;
};

function candidateId(candidate: TaxonomyImportCandidate): string | null {
  return typeof candidate.id === 'string' ? candidate.id : null;
}

function batchIdFromResponse(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('batch' in value)) return null;
  const batch = (value as { batch?: unknown }).batch;
  if (!batch || typeof batch !== 'object' || !('id' in batch)) return null;
  const id = (batch as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

export default function StagedImports({ batchId: initialBatchId }: { batchId?: string }) {
  const queryClient = useQueryClient();
  const { data: termsData } = useListGovernanceTerms();
  const [batchId, setBatchId] = useState(initialBatchId ?? '');
  const [batchLookup, setBatchLookup] = useState(initialBatchId ?? '');
  const [sourceName, setSourceName] = useState('');
  const [actor, setActor] = useState('');
  const [reason, setReason] = useState('');
  const [jsonRows, setJsonRows] = useState('[\n  {\n    "category": "",\n    "label": "",\n    "shortcode": ""\n  }\n]');
  const [formError, setFormError] = useState('');

  const { data: importData, isLoading: isImportLoading, error: importError } = useGetTaxonomyImport(
    batchId,
    {
      query: {
        ...getGetTaxonomyImportQueryOptions(batchId),
        enabled: Boolean(batchId),
      },
    },
  );
  const stageImport = useStageTaxonomyImport();
  const reviewCandidate = useReviewTaxonomyImportCandidate();
  const commitImport = useCommitTaxonomyImport();

  const invalidateBatch = (id: string) => {
    queryClient.invalidateQueries({ queryKey: getGetTaxonomyImportQueryOptions(id).queryKey });
    queryClient.invalidateQueries({ queryKey: getListGovernanceTermsQueryKey() });
  };

  const handleStage = () => {
    setFormError('');
    let candidates: unknown;
    try {
      candidates = JSON.parse(jsonRows);
    } catch {
      setFormError('Rows must be valid JSON.');
      return;
    }
    if (!Array.isArray(candidates) || candidates.length === 0 || candidates.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      setFormError('Rows must be a non-empty JSON array of objects.');
      return;
    }
    if (!termsData?.versionId) {
      setFormError('The current taxonomy version is not available yet.');
      return;
    }
    if (!sourceName.trim() || !actor.trim() || !reason.trim()) {
      setFormError('Source name, actor, and reason are required.');
      return;
    }
    stageImport.mutate(
      {
        data: {
          versionId: termsData.versionId,
          sourceName: sourceName.trim(),
          candidates: candidates as Record<string, unknown>[],
          actor: actor.trim(),
          reason: reason.trim(),
        },
      },
      {
        onSuccess: (response) => {
          const createdBatchId = batchIdFromResponse(response);
          if (!createdBatchId) {
            setFormError('The staging response did not include a batch id.');
            return;
          }
          setBatchId(createdBatchId);
          setBatchLookup(createdBatchId);
          invalidateBatch(createdBatchId);
        },
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Unable to stage the import.');
        },
      },
    );
  };

  const handleLoadBatch = () => {
    setFormError('');
    if (!batchLookup.trim()) {
      setFormError('Enter a batch id to load.');
      return;
    }
    setBatchId(batchLookup.trim());
  };

  const handleReview = (id: string, status: 'business_review_complete' | 'rejected', resolveConflict = false) => {
    if (!batchId || !actor.trim() || !reason.trim()) {
      setFormError('Actor and reason are required for review.');
      return;
    }
    reviewCandidate.mutate(
      {
        batchId,
        candidateId: id,
        data: {
          status,
          actor: actor.trim(),
          reason: reason.trim(),
          resolveConflict,
        } as any,
      },
      {
        onSuccess: () => invalidateBatch(batchId),
        onError: (error) => setFormError(error instanceof Error ? error.message : 'Unable to review the candidate.'),
      },
    );
  };

  const handleCommit = () => {
    if (!batchId || !actor.trim() || !reason.trim()) {
      setFormError('Actor and reason are required to apply provisional values.');
      return;
    }
    commitImport.mutate(
      { batchId, data: { actor: actor.trim(), reason: reason.trim() } },
      {
        onSuccess: () => invalidateBatch(batchId),
        onError: (error) => setFormError(error instanceof Error ? error.message : 'Unable to apply provisional values.'),
      },
    );
  };

  const candidates = (importData?.candidates ?? []) as ImportCandidate[];

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Staged Imports</CardTitle>
        <CardDescription>
          Stage taxonomy JSON, record business review, then apply values as provisional drafts. This never grants governance approval or publishing eligibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="import-source">Source name</Label>
            <Input id="import-source" value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Workbook or system name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-actor">Actor (self-declared)</Label>
            <Input id="import-actor" value={actor} onChange={(event) => setActor(event.target.value)} placeholder="Name or team" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-reason">Reason</Label>
          <Input id="import-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why this import is being staged or reviewed" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-json">Candidate rows (JSON array)</Label>
          <Textarea id="import-json" value={jsonRows} onChange={(event) => setJsonRows(event.target.value)} className="min-h-28 font-mono text-xs" />
        </div>
        {formError && <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{formError}</div>}
        {stageImport.isError && !formError && <div className="text-xs text-destructive">{stageImport.error instanceof Error ? stageImport.error.message : 'Unable to stage the import.'}</div>}
        <Button onClick={handleStage} disabled={stageImport.isPending || !termsData?.versionId} className="w-full">
          {stageImport.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Stage import
        </Button>

        <div className="border-t border-border pt-4 space-y-2">
          <Label htmlFor="import-batch-lookup">Load an existing batch (optional)</Label>
          <div className="flex gap-2">
            <Input id="import-batch-lookup" value={batchLookup} onChange={(event) => setBatchLookup(event.target.value)} placeholder="Batch UUID" />
            <Button variant="outline" onClick={handleLoadBatch} disabled={!batchLookup.trim()}><Search className="mr-2 h-4 w-4" />Load</Button>
          </div>
        </div>

        {batchId && (
          <div className="border-t border-border pt-4">
            {isImportLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : importError ? (
              <div className="text-sm text-destructive">Unable to load batch {batchId}.</div>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Batch {batchId}</div>
                    <div className="text-xs text-muted-foreground">
                      {typeof importData?.batch?.status === 'string' ? `Status: ${importData.batch.status}` : 'Review candidates below.'}
                    </div>
                  </div>
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                </div>
                {candidates.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-md">No candidates in this batch.</div>
                ) : (
                  <div className="space-y-3">
                    {candidates.map((row) => {
                      const id = candidateId(row);
                      if (!id) return null;
                      const isConflict = row.status === TaxonomyImportReviewStatus.conflict || (row.conflicts?.length ?? 0) > 0;
                      return (
                        <div key={id} className={`p-3 rounded-md border ${isConflict ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-card'}`}>
                          <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0 space-y-1">
                              <code className="text-xs font-mono break-all">{JSON.stringify(row.payload ?? row)}</code>
                              <div className="text-[10px] text-muted-foreground">
                                 Source review status: {String(row.status ?? 'unknown')} · quarantined
                                {row.conflictType ? ` · ${row.conflictType}` : ''}
                              </div>
                              {isConflict && (
                                <div className="flex items-start gap-1.5 text-xs text-destructive">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  <span>{row.conflicts?.join(', ') || 'Conflict detected. Review is required before any future validation decision.'}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-2 shrink-0">
                              <Button
                                size="sm"
                                onClick={() => handleReview(id, 'business_review_complete', isConflict)}
                                className="h-7 text-xs px-2"
                                variant={isConflict ? 'secondary' : 'default'}
                                disabled={reviewCandidate.isPending || row.status === 'business_review_complete'}
                              >
                                <Check className="h-3 w-3 mr-1" />
                                {row.status === 'business_review_complete'
                                  ? 'Business review complete'
                                  : isConflict ? 'Resolve & complete review' : 'Mark business review complete'}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => handleReview(id, 'rejected')} className="h-7 text-xs px-2" disabled={reviewCandidate.isPending}>
                                <X className="h-3 w-3 mr-1" /> Reject
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <Button variant="default" className="w-full" onClick={handleCommit} disabled={commitImport.isPending}>
                      {commitImport.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                      Apply provisional values
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}