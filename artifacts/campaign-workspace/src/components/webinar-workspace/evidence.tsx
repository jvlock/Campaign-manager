import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, History, Lock, FileCheck2 } from 'lucide-react';
import {
  useSubmitWebinarStandardEvidence, useRequestWebinarStandardException,
  getGetWebinarStandardEvidenceQueryKey, getGetWebinarStandardExceptionsQueryKey,
  getGetWebinarStandardHistoryQueryKey, getGetWebinarStandardSummaryQueryKey,
  type WebinarApiEvidenceList, type WebinarApiExceptionList,
  type WebinarApiFinding, type WebinarApiEvidenceInputEvidenceType,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusChip, ExplainTerm, RegionError, SimulationBadge } from './status';
import { classifyError, evidenceSourceChoices, availableSourcesOf, exceptionEligibility, formatInstant, type ClassifiedError } from '@/lib/webinar-workspace/adapters';
import { localDateTimeValue, anchorAt } from '@/lib/timezone';

const EVIDENCE_TYPES: { value: WebinarApiEvidenceInputEvidenceType; label: string; hint: string }[] = [
  { value: 'qa', label: 'QA check', hint: 'References content or the occurrence.' },
  { value: 'manual-review', label: 'Manual review', hint: 'References content.' },
  { value: 'source-observation', label: 'Source observation', hint: 'References any scoped source.' },
];

export function EvidencePanel({ campaignId, sessionId, evidence, timezone, announce }: {
  campaignId: string; sessionId: string; evidence: WebinarApiEvidenceList | undefined; timezone: string; announce: (m: string) => void;
}) {
  // Exact immutable row refs from GET evidence; never engine evaluation refs, never client-derived.
  const sources = availableSourcesOf(evidence);
  const qc = useQueryClient();
  const submit = useSubmitWebinarStandardEvidence();
  const [evidenceType, setEvidenceType] = useState<WebinarApiEvidenceInputEvidenceType>('qa');
  const [sourceValue, setSourceValue] = useState('');
  const [error, setError] = useState<ClassifiedError | null>(null);
  // Fixed request tuple reused unchanged on retry, per API contract.
  const tuple = useRef<{ key: string; at: string; body: string } | null>(null);
  const choices = useMemo(() => evidenceSourceChoices(sources ?? [], evidenceType), [sources, evidenceType]);
  const chosen = choices.find((c) => c.value === sourceValue);

  const doSubmit = () => {
    if (!chosen || !evidence || submit.isPending) return;
    const body = `${evidenceType}|${chosen.value}|${chosen.sourceHash}|${evidence.revision}`;
    if (!tuple.current || tuple.current.body !== body) tuple.current = { key: crypto.randomUUID(), at: new Date().toISOString(), body };
    setError(null);
    submit.mutate({ campaignId, sessionId, data: {
      sourceId: chosen.sourceId, evidenceType, sourceType: chosen.sourceType, sourceVersion: chosen.sourceVersion,
      sourceHash: chosen.sourceHash, expectedRevision: evidence.revision, idempotencyKey: tuple.current.key, calculationAt: tuple.current.at,
    } }, {
      onSuccess: (r) => {
        tuple.current = null; setSourceValue('');
        announce(`Evidence ${r.replayed ? 'replayed' : 'recorded'}. It is unverified and does not pass any rule.`);
        for (const k of [getGetWebinarStandardEvidenceQueryKey, getGetWebinarStandardHistoryQueryKey, getGetWebinarStandardSummaryQueryKey]) qc.invalidateQueries({ queryKey: k(campaignId, sessionId) });
      },
      onError: (e) => { const c = classifyError(e); setError(c); announce(`Evidence not recorded. ${c.title}.`); },
    });
  };

  return (
    <section aria-labelledby="ww-evidence-h" className="ww-panel p-4" data-testid="panel-evidence">
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2 aria-hidden="true" className="h-4 w-4" />
        <h3 id="ww-evidence-h" className="font-semibold">Evidence</h3>
        <ExplainTerm term="Evidence" explanation="A recorded reference to an exact immutable source version. Submitting evidence never passes a rule by itself; the engine decides on the next evaluation." />
        <SimulationBadge />
      </div>
      <p className="mt-1 text-sm text-muted-foreground" data-testid="text-evidence-boundary">Submitting evidence does not automatically satisfy a rule. Every record stays unverified because no trusted identity is available.</p>
      <ul className="mt-3 space-y-2" aria-label="Recorded evidence">
        {!evidence ? <li className="text-sm text-muted-foreground">Evidence records are loading.</li>
          : evidence.records.length === 0 ? <li className="text-sm text-muted-foreground">No evidence recorded for this webinar yet.</li>
          : evidence.records.map((r) => (
            <li key={r.id} className="rounded-md border border-border p-2 text-sm" data-testid={`evidence-${r.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{EVIDENCE_TYPES.find((t) => t.value === r.type)?.label ?? r.type}</span>
                <StatusChip label="Unverified actor" tone="unavailable" />
                <StatusChip label="Result unknown — not a pass" tone="incomplete" />
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">Source {r.sourceType ?? 'missing historical reference'} · {r.sourceId} · version {r.sourceVersion ?? 'unavailable'} · scope this webinar occurrence · recorded {formatInstant(r.recordedAt, timezone)}</p>
            </li>
          ))}
      </ul>
      <fieldset className="mt-4 space-y-3 border-t border-border pt-3">
        <legend className="text-sm font-semibold">Record development evidence</legend>
        <RadioGroup value={evidenceType} onValueChange={(v) => { setEvidenceType(v as WebinarApiEvidenceInputEvidenceType); setSourceValue(''); }} aria-label="Evidence type" className="grid gap-1 sm:grid-cols-3">
          {EVIDENCE_TYPES.map((t) => (
            <label key={t.value} className="ww-target flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm">
              <RadioGroupItem value={t.value} className="mt-0.5" /><span><span className="font-medium">{t.label}</span><span className="block text-xs text-muted-foreground">{t.hint}</span></span>
            </label>
          ))}
        </RadioGroup>
        <div className="space-y-1">
          <Label htmlFor="ww-evidence-source">Source (exact immutable version)</Label>
          {choices.length === 0 ? (
            <p className="text-sm text-muted-foreground" id="ww-evidence-source">{!evidence ? 'Sources are loading.' : 'No usable scoped source with an exact version and hash is available for this evidence type.'}</p>
          ) : (
            <Select value={sourceValue} onValueChange={setSourceValue}>
              <SelectTrigger id="ww-evidence-source" className="ww-target"><SelectValue placeholder="Choose a source" /></SelectTrigger>
              <SelectContent>{choices.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        {error && <RegionError title={error.title} message={error.message} nextAction={error.nextAction} onRetry={error.retrySafe ? doSubmit : undefined} />}
        <Button type="button" className="ww-target" onClick={doSubmit} disabled={!chosen || !evidence || submit.isPending} aria-busy={submit.isPending}>
          {submit.isPending ? 'Recording…' : 'Record unverified evidence'}
        </Button>
      </fieldset>
    </section>
  );
}

export function ExceptionPanel({ campaignId, sessionId, exceptions, blockers, nonblocking, evidence, timezone, announce }: {
  campaignId: string; sessionId: string; exceptions: WebinarApiExceptionList | undefined;
  blockers: WebinarApiFinding[]; nonblocking: WebinarApiFinding[]; evidence: WebinarApiEvidenceList | undefined;
  timezone: string; announce: (m: string) => void;
}) {
  const qc = useQueryClient();
  const request = useRequestWebinarStandardException();
  const [target, setTarget] = useState<WebinarApiFinding | null>(null);
  const [evidenceId, setEvidenceId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [expires, setExpires] = useState('');
  const [error, setError] = useState<ClassifiedError | null>(null);
  const tuple = useRef<{ key: string; at: string; body: string } | null>(null);
  const reasonValid = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(reasonCode);
  const expiresAt = anchorAt(expires, timezone);

  const doRequest = () => {
    if (!target || !evidence || !evidenceId || !reasonValid || !expiresAt || request.isPending) return;
    const body = `${target.ruleId}|${evidenceId}|${reasonCode}|${expiresAt}|${evidence.revision}`;
    if (!tuple.current || tuple.current.body !== body) tuple.current = { key: crypto.randomUUID(), at: new Date().toISOString(), body };
    setError(null);
    request.mutate({ campaignId, sessionId, data: { ruleId: target.ruleId, evidenceId, reasonCode, expectedRevision: evidence.revision, idempotencyKey: tuple.current.key, calculationAt: tuple.current.at, expiresAt } }, {
      onSuccess: () => {
        tuple.current = null; setTarget(null);
        announce('Draft exception request recorded. It is unreviewed and does not resolve the blocker.');
        for (const k of [getGetWebinarStandardExceptionsQueryKey, getGetWebinarStandardHistoryQueryKey, getGetWebinarStandardSummaryQueryKey]) qc.invalidateQueries({ queryKey: k(campaignId, sessionId) });
      },
      onError: (e) => { const c = classifyError(e); setError(c); announce(`Exception request failed. ${c.title}.`); },
    });
  };

  return (
    <section aria-labelledby="ww-exc-h" className="ww-panel p-4" data-testid="panel-exceptions">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck aria-hidden="true" className="h-4 w-4" />
        <h3 id="ww-exc-h" className="font-semibold">Exceptions</h3>
        <ExplainTerm term="Exception" explanation="A governed, time-limited acceptance of one failed blocking rule. Requests here are drafts; only a trusted reviewer can decide them." />
      </div>
      <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2 text-sm" data-testid="text-review-unavailable">
        <Lock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        <p><span className="font-semibold">Review unavailable.</span> Approving an exception requires a trusted, authenticated reviewer who is not the requester. This workspace has no trusted identity, so no one can review here, and typed names or emails are not accepted as identity.</p>
      </div>
      <h4 className="mt-3 text-sm font-semibold">Requested exceptions</h4>
      <ul className="mt-1 space-y-2">
        {!exceptions ? <li className="text-sm text-muted-foreground">Loading exception requests.</li>
          : exceptions.records.length === 0 ? <li className="text-sm text-muted-foreground">No exception requests.</li>
          : exceptions.records.map((x) => (
            <li key={x.id} className="rounded-md border border-border p-2 text-sm" data-testid={`exception-${x.id}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{x.ruleId}</span><StatusChip label="Review required" /><StatusChip label="Draft — unverified" tone="unavailable" /></div>
              <p className="mt-1 text-xs text-muted-foreground">Reason {x.reasonCode} · evidence {x.evidenceId.slice(0, 8)} · requested expiry {x.requestedExpiresAt ? formatInstant(x.requestedExpiresAt, timezone) : 'none'} · does not resolve the blocker</p>
            </li>
          ))}
      </ul>
      <h4 className="mt-3 text-sm font-semibold">Blocking findings</h4>
      <ul className="mt-1 space-y-2" aria-label="Blocking findings and exception eligibility">
        {blockers.length === 0 && <li className="text-sm text-muted-foreground">No unresolved blocking findings in the last evaluation.</li>}
        {blockers.map((f) => {
          const el = exceptionEligibility(f, true);
          return (
            <li key={`${f.ruleId}-${f.participantId ?? ''}`} className="rounded-md border border-border p-2 text-sm" data-testid={`blocker-${f.ruleId}`}>
              <div className="flex flex-wrap items-center gap-2"><StatusChip label="Blocked" /><span className="font-medium">{f.rule.ruleName}</span><span className="font-mono text-xs text-muted-foreground">{f.ruleId}</span></div>
              <p className="mt-1 text-xs text-muted-foreground">{el.reason}</p>
              {el.eligible ? (
                <Button type="button" variant="outline" size="sm" className="ww-target mt-2" onClick={() => { setTarget(f); setError(null); setEvidenceId(''); setReasonCode(''); setExpires(localDateTimeValue(new Date(Date.now() + 7 * 864e5).toISOString(), timezone)); }}>Request draft exception</Button>
              ) : <p className="mt-1 text-xs font-medium" data-testid={`no-exception-${f.ruleId}`}>No exception action available.</p>}
            </li>
          );
        })}
      </ul>
      {nonblocking.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{nonblocking.length} nonblocking warning{nonblocking.length === 1 ? '' : 's'} do not need exceptions.</p>}
      <Dialog open={!!target} onOpenChange={(o) => { if (!o && !request.isPending) setTarget(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a draft exception</DialogTitle>
            <DialogDescription>For {target?.ruleId}. The request stays a draft; it does not resolve the blocker and cannot be reviewed without a trusted reviewer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ww-exc-evidence">Supporting evidence</Label>
              {(evidence?.records.length ?? 0) === 0 ? <p id="ww-exc-evidence" className="text-sm text-muted-foreground">Record evidence first; a request must reference an evidence record.</p> : (
                <Select value={evidenceId} onValueChange={setEvidenceId}>
                  <SelectTrigger id="ww-exc-evidence" className="ww-target"><SelectValue placeholder="Choose evidence" /></SelectTrigger>
                  <SelectContent>{evidence?.records.map((r) => <SelectItem key={r.id} value={r.id}>{r.type} · {r.sourceType} · {formatInstant(r.recordedAt, timezone)}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ww-exc-reason">Reason code</Label>
              <Input id="ww-exc-reason" className="ww-target font-mono" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-invalid={reasonCode !== '' && !reasonValid} aria-describedby="ww-exc-reason-hint" />
              <p id="ww-exc-reason-hint" className="text-xs text-muted-foreground">A short code (letters, digits, . _ : -). Not a name or identity.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ww-exc-expiry">Requested expiry ({timezone})</Label>
              <Input id="ww-exc-expiry" type="datetime-local" className="ww-target" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
            {error && <RegionError title={error.title} message={error.message} nextAction={error.nextAction} onRetry={error.retrySafe ? doRequest : undefined} />}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="ww-target" onClick={() => setTarget(null)} disabled={request.isPending}>Cancel</Button>
            <Button type="button" className="ww-target" onClick={doRequest} disabled={!evidenceId || !reasonValid || !expiresAt || request.isPending}>{request.isPending ? 'Requesting…' : 'Record draft request'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function HistoryList({ records, timezone }: { records: { id: string; kind: string; createdAt: string; revision: number }[] | undefined; timezone: string }) {
  return (
    <section aria-labelledby="ww-hist-h" className="ww-panel p-4">
      <div className="flex items-center gap-2"><History aria-hidden="true" className="h-4 w-4" /><h3 id="ww-hist-h" className="font-semibold">History</h3></div>
      <ol className="mt-2 space-y-1 text-sm">
        {!records ? <li className="text-muted-foreground">Loading history.</li> : records.length === 0 ? <li className="text-muted-foreground">No immutable records yet.</li>
          : records.slice(0, 12).map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2 border-b border-border py-1 last:border-0"><span className="capitalize">{r.kind.replace(/-/g, ' ')} · rev {r.revision}</span><span className="text-xs text-muted-foreground">{formatInstant(r.createdAt, timezone)}</span></li>)}
      </ol>
    </section>
  );
}
