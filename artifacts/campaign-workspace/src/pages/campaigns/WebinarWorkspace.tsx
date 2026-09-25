import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, FlaskConical, Lock, ListChecks, ArrowRight, PlayCircle, CalendarDays } from 'lucide-react';
import {
  useGetCampaign, getGetCampaignQueryKey, useGetWebinar, getGetWebinarQueryKey, useUpdateWebinar, useGetWebinarStandard, getGetWebinarStandardQueryKey,
  useUpdateWebinarStandard, usePreviewWebinarDateImpact, useGetWebinarStandardSummary, getGetWebinarStandardSummaryQueryKey,
  useGetWebinarStandardReadiness, getGetWebinarStandardReadinessQueryKey, useGetWebinarStandardEvaluations, getGetWebinarStandardEvaluationsQueryKey,
  useGetWebinarStandardEvidence, getGetWebinarStandardEvidenceQueryKey, getWebinarStandardEvidence, useGetWebinarStandardExceptions,
  useGetWebinarStandardHistory, getGetWebinarStandardHistoryQueryKey, useEvaluateWebinarStandard, getGetWebinarStandardCompletionQueryKey,
  getGetWebinarStandardExceptionsQueryKey, getListWebinarsQueryKey,
  type WebinarSession, type WebinarStandard, type WebinarDateImpact, type WebinarUpdate,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusChip, SimulationBadge, RegionError, ExplainTerm } from '@/components/webinar-workspace/status';
import {
  WhyStep, WhoStep, WhatStep, WhenStep, WhereStep, HowStep, ReviewStep, SaveBar, ErrorSummary, DateImpactList, STEP_ICON,
  validateStep, fieldToStep, stepStatus, findingStep, findingRoute, type SessionDraft, type VariantDraft, type FieldErrors, type StepProps,
} from '@/components/webinar-workspace/setup';
import { RecruitmentView, type OverdueSource } from '@/components/webinar-workspace/recruitment';
import { EvidencePanel, ExceptionPanel, HistoryList } from '@/components/webinar-workspace/evidence';
import {
  SETUP_STEPS, classifyError, isDirty, changedFields, touchesTiming, formatInstant, stageNamed, simulationReadinessText, overdueAuthorityFromPreview, freshness, FRESHNESS_LABEL,
  summarizeDateImpact, stepForField, type SetupStepId, type ClassifiedError,
} from '@/lib/webinar-workspace/adapters';
import { anchorAt, localDateTimeValue } from '@/lib/timezone';
import { installBackGuard, type BackGuard } from '@/lib/webinar-workspace/navigation-guard';

type Area = 'setup' | 'recruitment' | 'followup' | 'readiness';
const EDITABLE_STEPS: SetupStepId[] = ['who', 'what', 'when', 'where'];

export function sessionToDraft(s: WebinarSession): SessionDraft {
  return {
    name: s.name, sessionDate: s.sessionDate, startTime: s.startTime, durationMinutes: String(s.durationMinutes), timezone: s.timezone,
    platform: s.platform, speakers: (s.speakers ?? []).map((x) => ({ name: x.name, role: x.role ?? '', organization: x.organization ?? '' })),
    recruitmentLaunchLocal: localDateTimeValue(s.recruitmentLaunchAt, s.timezone),
  };
}
export function standardToVariants(st: WebinarStandard): VariantDraft[] {
  return st.templateConfig.variants.map((v) => ({ slot: v.slot, name: v.name, inUse: v.inUse, audienceDefinition: v.audienceDefinition, messageAngle: v.messageAngle, valueProposition: v.valueProposition }));
}

/** Fields each step owns in the session draft. */
const STEP_SESSION_FIELDS: Record<SetupStepId, (keyof SessionDraft)[]> = {
  why: [], who: [], what: ['speakers'], when: ['sessionDate', 'startTime', 'durationMinutes', 'timezone', 'recruitmentLaunchLocal'], where: ['platform'], how: [], review: [],
};

/** Registration suppression is canonical and read-only; the existing planning title cannot be edited through the current API (it rejects
 *  direct names and only accepts namingInput on activity creation). Neither is ever part of an update. */
export function buildWebinarUpdate(step: SetupStepId, base: SessionDraft, draft: SessionDraft): Omit<WebinarUpdate, 'expectedVersion'> {
  const pick = (d: SessionDraft) => Object.fromEntries(STEP_SESSION_FIELDS[step].map((k) => [k, d[k]])) as Partial<SessionDraft>;
  const ch = changedFields(pick(base) as Record<string, unknown>, pick(draft) as Record<string, unknown>) as Partial<SessionDraft>;
  const out: Omit<WebinarUpdate, 'expectedVersion'> = {};
  if (ch.speakers !== undefined) out.speakers = ch.speakers.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), ...(s.role.trim() ? { role: s.role.trim() } : {}), ...(s.organization.trim() ? { organization: s.organization.trim() } : {}) }));
  if (ch.sessionDate !== undefined) out.sessionDate = ch.sessionDate;
  if (ch.startTime !== undefined) out.startTime = ch.startTime;
  if (ch.durationMinutes !== undefined) out.durationMinutes = Number(ch.durationMinutes);
  if (ch.timezone !== undefined) out.timezone = ch.timezone;
  if (ch.platform !== undefined) out.platform = ch.platform;
  if (ch.recruitmentLaunchLocal !== undefined || (ch.timezone !== undefined && draft.recruitmentLaunchLocal)) {
    const inst = anchorAt(draft.recruitmentLaunchLocal, draft.timezone);
    if (inst) out.recruitmentLaunchAt = inst;
  }
  return out;
}

export default function WebinarWorkspace() {
  const [, params] = useRoute('/campaigns/:id/webinars/:sessionId/setup');
  const campaignId = params?.id ?? '';
  const sessionId = params?.sessionId ?? '';
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const enabled = Boolean(campaignId && sessionId);
  const noRetry = { retry: false as const };

  const campaign = useGetCampaign(campaignId, { query: { queryKey: getGetCampaignQueryKey(campaignId), enabled: Boolean(campaignId) } });
  const session = useGetWebinar(campaignId, sessionId, { query: { queryKey: getGetWebinarQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const standard = useGetWebinarStandard(campaignId, sessionId, { query: { queryKey: getGetWebinarStandardQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const summary = useGetWebinarStandardSummary(campaignId, sessionId, { query: { queryKey: getGetWebinarStandardSummaryQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const readiness = useGetWebinarStandardReadiness(campaignId, sessionId, { query: { queryKey: getGetWebinarStandardReadinessQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const evaluations = useGetWebinarStandardEvaluations(campaignId, sessionId, { query: { queryKey: getGetWebinarStandardEvaluationsQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const evidence = useGetWebinarStandardEvidence(campaignId, sessionId, { query: { queryKey: getGetWebinarStandardEvidenceQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const exceptions = useGetWebinarStandardExceptions(campaignId, sessionId, { query: { queryKey: getGetWebinarStandardExceptionsQueryKey(campaignId, sessionId), enabled, ...noRetry } });
  const history = useGetWebinarStandardHistory(campaignId, sessionId, undefined, { query: { queryKey: getGetWebinarStandardHistoryQueryKey(campaignId, sessionId), enabled, ...noRetry } });

  const updateWebinar = useUpdateWebinar();
  const updateStandard = useUpdateWebinarStandard();
  const preview = usePreviewWebinarDateImpact();
  const evaluate = useEvaluateWebinarStandard();

  const [area, setArea] = useState<Area>('setup');
  const [step, setStep] = useState<SetupStepId>('why');
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((m: string) => { setAnnouncement(''); requestAnimationFrame(() => setAnnouncement(m)); }, []);

  // ---------- Drafts with once-per-version baselines ----------
  const [base, setBase] = useState<SessionDraft | null>(null);
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [vBase, setVBase] = useState<VariantDraft[] | null>(null);
  const [variants, setVariants] = useState<VariantDraft[] | null>(null);
  const sessionVersion = useRef<string | undefined>(undefined);
  const standardVersion = useRef<string | undefined>(undefined);
  const [serverNewer, setServerNewer] = useState(false);

  const dirtyNow = draft && base ? isDirty(base, draft) : false;
  const variantsDirty = variants && vBase ? isDirty(vBase, variants) : false;

  useEffect(() => {
    const s = session.data;
    if (!s) return;
    if (sessionVersion.current === undefined) {
      sessionVersion.current = s.editVersion; setBase(sessionToDraft(s)); setDraft(sessionToDraft(s));
    } else if (s.editVersion !== sessionVersion.current) {
      // Never silently replace a user's draft; only rebaseline untouched forms.
      if (!dirtyNow) { sessionVersion.current = s.editVersion; setBase(sessionToDraft(s)); setDraft(sessionToDraft(s)); } else setServerNewer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.data]);
  useEffect(() => {
    const st = standard.data;
    if (!st) return;
    if (standardVersion.current === undefined) {
      standardVersion.current = st.editVersion; setVBase(standardToVariants(st)); setVariants(standardToVariants(st));
    } else if (st.editVersion !== standardVersion.current) {
      if (!variantsDirty) { standardVersion.current = st.editVersion; setVBase(standardToVariants(st)); setVariants(standardToVariants(st)); } else setServerNewer(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standard.data]);

  const stepDirty = useCallback((s: SetupStepId) => {
    if (!draft || !base) return false;
    const fields = STEP_SESSION_FIELDS[s];
    const sd = fields.some((k) => isDirty(base[k], draft[k]));
    return sd || (s === 'who' && !!variantsDirty);
  }, [draft, base, variantsDirty]);
  const dirtySteps = EDITABLE_STEPS.filter(stepDirty);
  const anyDirty = dirtySteps.length > 0;

  // ---------- Leave protection ----------
  const [pendingNav, setPendingNav] = useState<null | { kind: 'step'; to: SetupStepId } | { kind: 'area'; to: Area } | { kind: 'href'; to: string } | { kind: 'back' }>(null);
  const backGuard = useRef<BackGuard | null>(null);
  useEffect(() => {
    if (!anyDirty) return;
    backGuard.current = installBackGuard(window, () => setPendingNav({ kind: 'back' }));
    return () => { backGuard.current?.dispose(); backGuard.current = null; };
  }, [anyDirty]);
  useEffect(() => {
    if (!anyDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a || a.target === '_blank' || e.defaultPrevented || a.hasAttribute('data-ww-safe')) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      e.preventDefault(); e.stopPropagation();
      setPendingNav({ kind: 'href', to: href });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); document.removeEventListener('click', onClick, true); };
  }, [anyDirty]);

  const discardAll = () => { if (base) setDraft(base); if (vBase) setVariants(vBase); setErrors({}); setServerError(null); };
  const completeNav = (nav: NonNullable<typeof pendingNav>) => {
    if (nav.kind === 'step') setStep(nav.to);
    else if (nav.kind === 'area') setArea(nav.to);
    else if (nav.kind === 'back') { const g = backGuard.current; backGuard.current = null; g?.release(); }
    else {
      backGuard.current?.abandon(); backGuard.current = null;
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, '');
      setLocation(nav.to.startsWith(baseUrl) ? nav.to.slice(baseUrl.length) || '/' : nav.to);
    }
  };
  const goStep = (to: SetupStepId) => {
    if (to === step) return;
    if (stepDirty(step)) setPendingNav({ kind: 'step', to }); else { setStep(to); setErrors({}); setServerError(null); }
  };
  const goArea = (to: Area) => { if (to === 'followup') return; if (anyDirty && area === 'setup') setPendingNav({ kind: 'area', to }); else setArea(to); };

  // ---------- Save ----------
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<ClassifiedError | null>(null);
  const [conflict, setConflict] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [savedSinceEval, setSavedSinceEval] = useState(false);
  const [impact, setImpact] = useState<WebinarDateImpact | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const lastAttempt = useRef<(() => void) | null>(null);

  const invalidateAll = () => {
    for (const k of [getGetWebinarQueryKey, getGetWebinarStandardQueryKey, getGetWebinarStandardSummaryQueryKey, getGetWebinarStandardReadinessQueryKey, getGetWebinarStandardEvaluationsQueryKey, getGetWebinarStandardEvidenceQueryKey, getGetWebinarStandardHistoryQueryKey, getGetWebinarStandardCompletionQueryKey]) {
      void qc.invalidateQueries({ queryKey: k(campaignId, sessionId) });
    }
    void qc.invalidateQueries({ queryKey: getListWebinarsQueryKey(campaignId) });
  };

  const failSave = (e: unknown) => {
    inFlight.current = false;
    const c = classifyError(e);
    if (c.kind === 'conflict') setConflict(true);
    const fieldErr: FieldErrors = {};
    if (c.kind === 'validation' && c.field) { fieldErr[c.field] = c.message; if (fieldToStep(c.field) !== step) setStep(fieldToStep(c.field)); }
    setErrors(fieldErr); setServerError(c);
    announce(`Not saved. ${c.title}. Your changes are kept.`);
    requestAnimationFrame(() => summaryRef.current?.focus());
  };

  const runEvaluation = useCallback(async (reason: string) => {
    if (evaluate.isPending) return;
    try {
      const ev = await qc.fetchQuery({ queryKey: getGetWebinarStandardEvidenceQueryKey(campaignId, sessionId), queryFn: () => getWebinarStandardEvidence(campaignId, sessionId), staleTime: 0 });
      announce(`${reason} Running simulation evaluation…`);
      await evaluate.mutateAsync({ campaignId, sessionId, data: { expectedRevision: ev.revision, idempotencyKey: crypto.randomUUID(), calculationAt: new Date().toISOString() } });
      setSavedSinceEval(false);
      announce('Simulation evaluation complete. Results are synthetic and not operational approval.');
    } catch (e) {
      const c = classifyError(e);
      announce(`Evaluation did not complete. ${c.title}.`);
    } finally {
      invalidateAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, sessionId, evaluate.isPending]);

  const onSaved = (fresh: WebinarSession | null, freshStd: WebinarStandard | null, reevaluate: boolean) => {
    inFlight.current = false;
    if (fresh) {
      sessionVersion.current = fresh.editVersion;
      const nd = sessionToDraft(fresh);
      // Keep other steps' unsaved edits; rebaseline only saved fields.
      setBase(nd);
      setDraft((d) => { if (!d) return nd; const merged = { ...nd }; for (const s of EDITABLE_STEPS) if (s !== step) for (const k of STEP_SESSION_FIELDS[s]) (merged as Record<string, unknown>)[k] = d[k]; return merged; });
      qc.setQueryData(getGetWebinarQueryKey(campaignId, sessionId), fresh);
    }
    if (freshStd) { standardVersion.current = freshStd.editVersion; setVBase(standardToVariants(freshStd)); setVariants(standardToVariants(freshStd)); qc.setQueryData(getGetWebinarStandardQueryKey(campaignId, sessionId), freshStd); }
    const at = new Date().toISOString();
    setLastSaved(formatInstant(at, draft?.timezone || 'UTC')); setSavedSinceEval(true); setErrors({}); setServerError(null); setConflict(false);
    announce(`${SETUP_STEPS.find((s) => s.id === step)?.label} saved.`);
    if (reevaluate) void runEvaluation('Date saved; prior results are stale.');
    else invalidateAll();
  };

  const saveStep = (andContinue: boolean) => {
    if (!draft || !base || !variants || !session.data || inFlight.current || conflict) return;
    const v = validateStep(step, draft, variants);
    if (Object.keys(v).length) { setErrors(v); setServerError(null); announce('Some details need correcting.'); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    if (!stepDirty(step)) { if (andContinue) nextStep(); return; }
    const changes = buildWebinarUpdate(step, base, draft);
    const attempt = () => saveStep(andContinue);
    lastAttempt.current = attempt;
    if (step === 'when' && touchesTiming(changes as Record<string, unknown>)) {
      if (!sessionVersion.current) return;
      inFlight.current = true; setServerError(null);
      preview.mutate({ id: campaignId, sessionId, data: { expectedVersion: sessionVersion.current, sessionDate: changes.sessionDate, startTime: changes.startTime, durationMinutes: changes.durationMinutes, timezone: changes.timezone, recruitmentLaunchAt: changes.recruitmentLaunchAt } }, {
        onSuccess: (r) => { inFlight.current = false; setImpact(r); setImpactOpen(true); announce(`Date impact ready: ${r.changedCount} touches change, ${r.newlyOverdueCount} newly overdue.`); },
        onError: failSave,
      });
      return;
    }
    const sessionPart = Object.keys(changes).length > 0;
    const stdPart = step === 'who' && variantsDirty;
    inFlight.current = true;
    const doStd = (fresh: WebinarSession | null) => {
      if (!stdPart || !standardVersion.current) { onSaved(fresh, null, false); if (andContinue) nextStep(); return; }
      updateStandard.mutate({ id: campaignId, sessionId, data: { expectedVersion: standardVersion.current, templateConfig: { variants: variants.map((x) => ({ ...x })) } } }, {
        onSuccess: (st) => { onSaved(fresh, st, false); if (andContinue) nextStep(); },
        onError: (e) => { if (fresh) onSaved(fresh, null, false); failSave(e); },
      });
    };
    if (sessionPart) {
      updateWebinar.mutate({ id: campaignId, sessionId, data: { expectedVersion: sessionVersion.current, ...changes } }, { onSuccess: (fresh) => doStd(fresh), onError: failSave });
    } else doStd(null);
  };

  const confirmDateSave = () => {
    if (!impact || !draft || !base || !session.data || inFlight.current) return;
    const changes = buildWebinarUpdate('when', base, draft);
    inFlight.current = true;
    // Save with the preview's version token; a newer server version yields a conflict, never an overwrite.
    updateWebinar.mutate({ id: campaignId, sessionId, data: { expectedVersion: impact.editVersion, ...changes } }, {
      onSuccess: (fresh) => { setImpactOpen(false); setImpact(null); onSaved(fresh, null, true); },
      onError: (e) => { setImpactOpen(false); failSave(e); },
    });
  };

  const reloadLatest = async () => {
    sessionVersion.current = undefined; standardVersion.current = undefined;
    setConflict(false); setServerNewer(false); setServerError(null); setErrors({});
    await Promise.all([session.refetch(), standard.refetch()]);
    const s = qc.getQueryData<WebinarSession>(getGetWebinarQueryKey(campaignId, sessionId));
    const st = qc.getQueryData<WebinarStandard>(getGetWebinarStandardQueryKey(campaignId, sessionId));
    if (s) { sessionVersion.current = s.editVersion; setBase(sessionToDraft(s)); setDraft(sessionToDraft(s)); }
    if (st) { standardVersion.current = st.editVersion; setVBase(standardToVariants(st)); setVariants(standardToVariants(st)); }
    announce('Latest version loaded. Reapply any changes you still need.');
  };

  const stepIndex = SETUP_STEPS.findIndex((s) => s.id === step);
  const nextStep = () => { const n = SETUP_STEPS[stepIndex + 1]; if (n) { setStep(n.id); setErrors({}); } };
  const prevStep = () => { const p = SETUP_STEPS[stepIndex - 1]; if (p) goStep(p.id); };

  // ---------- Authoritative overdue: non-mutating backend preview of the CURRENT values, once per version ----------
  const currentPreview = usePreviewWebinarDateImpact();
  const [overdueSource, setOverdueSource] = useState<OverdueSource>({ status: 'loading' });
  const previewedVersion = useRef<string | null>(null);
  const cpMutate = useRef(currentPreview.mutate); cpMutate.current = currentPreview.mutate;
  useEffect(() => {
    const cur = session.data;
    if (!cur || previewedVersion.current === (cur.editVersion ?? '')) return;
    previewedVersion.current = cur.editVersion ?? '';
    if (!cur.editVersion) { setOverdueSource({ status: 'unavailable', reason: 'no version token for this session.' }); return; }
    const version = cur.editVersion;
    setOverdueSource({ status: 'loading' });
    cpMutate.current({ id: campaignId, sessionId, data: { expectedVersion: version, sessionDate: cur.sessionDate, startTime: cur.startTime, durationMinutes: cur.durationMinutes, timezone: cur.timezone, recruitmentLaunchAt: cur.recruitmentLaunchAt || undefined } }, {
      onSuccess: (r) => { if (r.editVersion === version) setOverdueSource({ status: 'ready', auth: overdueAuthorityFromPreview(r) }); else setOverdueSource({ status: 'unavailable', reason: 'the preview was for a different version.' }); },
      onError: (e) => setOverdueSource({ status: 'unavailable', reason: `${classifyError(e).title}.` }),
    });
  }, [session.data, campaignId, sessionId]);

  // ---------- Derived ----------
  const stage = stageNamed(readiness.data?.stages, 'Ready to recruit');
  const tz = session.data?.timezone ?? 'UTC';
  const lastEvaluated = summary.data?.calculationAt ?? null;
  const fresh = freshness(summary.data?.staleness, savedSinceEval || anyDirty);
  const activity = campaign.data?.map.activities.find((a) => a.id === session.data?.activityId);
  const isWebinarActivity = !activity || activity.type === 'Webinar' || activity.activityTypeId === 'webinar';
  const topBlocker = stage?.unresolvedBlockingFailures[0];
  const nextAction = useMemo(() => {
    if (conflict) return { text: 'Load the latest version, then reapply your changes.', act: () => void reloadLatest(), label: 'Load latest' };
    if (anyDirty) return { text: `Save your changes in ${dirtySteps.map((s) => SETUP_STEPS.find((x) => x.id === s)?.label).join(', ')}.`, act: () => { setArea('setup'); setStep(dirtySteps[0]); }, label: 'Go to changes' };
    if (!lastEvaluated) return { text: 'Run a simulation evaluation to see what is complete and what needs work.', act: () => void runEvaluation('Requested.'), label: 'Run evaluation' };
    if (fresh !== 'current') return { text: 'Results may be out of date. Re-run the simulation evaluation.', act: () => void runEvaluation('Requested.'), label: 'Re-evaluate' };
    if (topBlocker) return { text: `${topBlocker.rule.ruleName}: ${topBlocker.rule.resolutionGuidance}`, act: () => { if (findingRoute(topBlocker) === 'recruitment') setArea('recruitment'); else { setArea('setup'); setStep(findingStep(topBlocker)); } }, label: 'Fix this' };
    if (stage?.missingInputs[0]) return { text: `Provide ${stage.missingInputs[0].field}: ${stage.missingInputs[0].reason}`, act: () => { setArea('setup'); setStep(stepForField(stage.missingInputs[0].field)); }, label: 'Go to section' };
    return { text: 'Review the recruitment sequence.', act: () => setArea('recruitment'), label: 'Open Recruitment' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict, anyDirty, dirtySteps.join(), lastEvaluated, fresh, topBlocker, stage, runEvaluation]);

  // ---------- Render states ----------
  if (!enabled) return <section aria-label="Webinar workspace" className="p-6">Missing webinar reference.</section>;
  if (session.isPending) return <WorkspaceSkeleton />;
  if (session.isError || !session.data) {
    const c = classifyError(session.error);
    return <section aria-label="Webinar workspace" className="mx-auto max-w-2xl p-6"><RegionError testId="error-session" title={c.kind === 'not_found' ? 'Webinar session not found' : c.title} message={c.message} nextAction={c.nextAction} onRetry={c.retrySafe ? () => void session.refetch() : undefined} /><Link href={`/campaigns/${campaignId}`} className="ww-link-btn mt-3 inline-flex items-center">Back to campaign</Link></section>;
  }
  if (!isWebinarActivity) {
    return <section aria-label="Webinar workspace" className="mx-auto max-w-2xl p-6" data-testid="status-not-webinar"><RegionError title="This activity is not a webinar" nextAction="The webinar Setup and Recruitment workspace only applies to webinar activities. Return to the campaign map." /><Link href={`/campaigns/${campaignId}`} className="ww-link-btn mt-3 inline-flex">Back to campaign</Link></section>;
  }
  const s = session.data;
  const standardIneligible = summary.isError ? classifyError(summary.error) : null;
  const stepProps: StepProps | null = draft && variants ? {
    campaign: campaign.data, session: s, standard: standard.data, summary: summary.data, stage, draft, setDraft, variants, setVariants, errors, goTo: (x) => goStep(x), openRecruitment: () => goArea('recruitment'),
  } : null;

  const areas: { id: Area; label: string; disabledReason?: string }[] = [
    { id: 'setup', label: 'Setup' }, { id: 'recruitment', label: 'Recruitment' },
    { id: 'followup', label: 'Follow-up', disabledReason: 'Coming in the next authorized phase' }, { id: 'readiness', label: 'Readiness' },
  ];

  const renderTaskPanel = (p: 'desktop' | 'mobile') => (
    <div className="space-y-4" data-testid={`panel-tasks-${p}`}>
      <section aria-labelledby={`ww-${p}-next-h`}>
        <h2 id={`ww-${p}-next-h`} className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recommended next action</h2>
        <p className="mt-1 text-sm" data-testid="text-next-action">{nextAction.text}</p>
        <Button type="button" size="sm" className="ww-target mt-2" onClick={nextAction.act} disabled={evaluate.isPending}>{nextAction.label}<ArrowRight aria-hidden="true" className="ml-1 h-4 w-4" /></Button>
      </section>
      <section aria-labelledby={`ww-${p}-crit-h`}>
        <h2 id={`ww-${p}-crit-h`} className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Critical issues</h2>
        {!stage ? <p className="mt-1 text-sm text-muted-foreground">Not evaluated yet.</p> : stage.unresolvedBlockingFailures.length === 0 ? <p className="mt-1 text-sm">No unresolved blockers for recruitment.</p> : (
          <ul className="mt-1 space-y-1 text-sm">{stage.unresolvedBlockingFailures.slice(0, 5).map((f) => <li key={f.ruleId}><button type="button" className="ww-link-btn text-left" onClick={() => { if (findingRoute(f) === 'recruitment') goArea('recruitment'); else { setArea('setup'); goStep(findingStep(f)); } }}>{f.rule.ruleName}</button></li>)}</ul>
        )}
      </section>
      <section aria-labelledby={`ww-${p}-fresh-h`} className="text-sm">
        <h2 id={`ww-${p}-fresh-h`} className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Save and evaluation</h2>
        <dl className="mt-1 space-y-1">
          <div className="flex justify-between gap-2"><dt>Last saved</dt><dd data-testid="text-last-saved">{lastSaved ?? (s.updatedAt ? formatInstant(s.updatedAt, tz) : 'Unknown')}</dd></div>
          <div className="flex justify-between gap-2"><dt>Last evaluated</dt><dd data-testid="text-last-evaluated">{lastEvaluated ? formatInstant(lastEvaluated, tz) : 'Never'}</dd></div>
          <div className="flex items-center justify-between gap-2"><dt className="inline-flex items-center">Results <ExplainTerm term="Stale evaluation" explanation="The inputs changed after the last evaluation, so its findings may no longer apply until you evaluate again." /></dt><dd><StatusChip label={FRESHNESS_LABEL[fresh]} testId="status-freshness" /></dd></div>
          <div className="flex items-center justify-between gap-2"><dt className="inline-flex items-center">Evaluator coverage <ExplainTerm term="Evaluator coverage" explanation="How many of the standard's rules have an implemented check. Full coverage means every rule can be checked — not that the webinar is ready." /></dt><dd>{summary.data?.evaluation.coverage ? `${summary.data.evaluation.coverage.implementedRuleCount}/${summary.data.evaluation.coverage.totalRuleCount}` : 'Not evaluated'}</dd></div>
          {summary.data?.engineReleaseFingerprint && <div className="flex items-center justify-between gap-2"><dt className="inline-flex items-center">Release <ExplainTerm term="Release fingerprint" explanation="Identifies the exact rules engine version that produced these results." /></dt><dd className="font-mono text-xs">{summary.data.engineReleaseFingerprint.slice(0, 10)}</dd></div>}
        </dl>
        <Button type="button" variant="outline" size="sm" className="ww-target mt-2 w-full" onClick={() => void runEvaluation('Requested.')} disabled={evaluate.isPending || anyDirty} data-testid="button-evaluate">
          <PlayCircle aria-hidden="true" className="mr-1 h-4 w-4" />{evaluate.isPending ? 'Evaluating…' : 'Run simulation evaluation'}
        </Button>
        {anyDirty && <p className="mt-1 text-xs text-muted-foreground">Save your changes before evaluating.</p>}
      </section>
    </div>
  );

  return (
    <section className="min-w-0 overflow-x-hidden" aria-labelledby="ww-title" data-testid="region-webinar-workspace">
      <p className="sr-only" role="status" aria-live="polite" data-testid="live-region">{announcement}</p>
      <div className="ww-sim-ribbon flex flex-wrap items-center gap-2 px-4 py-1.5 text-xs font-semibold" data-testid="banner-simulation">
        <FlaskConical aria-hidden="true" className="h-3.5 w-3.5" /> Development simulation · synthetic data only · nothing is sent, published, or approved
      </div>
      <header className="ww-hero px-4 pb-4 pt-3 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link href="/campaigns" className="hover:underline">Campaigns</Link></li><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
            <li><Link href={`/campaigns/${campaignId}`} className="hover:underline" data-testid="link-campaign">{campaign.data?.name ?? 'Campaign'}</Link></li><ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
            <li aria-current="page" className="font-medium text-foreground">Webinar activity</li>
          </ol>
        </nav>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id="ww-title" className="break-words text-2xl font-semibold tracking-tight">{s.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><CalendarDays aria-hidden="true" className="h-4 w-4" />{s.sessionDate} · {s.startTime} · {s.timezone} · {s.durationMinutes} min</span>
              <span>Event status: {summary.data?.eventStatus ?? 'unknown'}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SimulationBadge />
            <StatusChip label={simulationReadinessText(stage)} tone={stage?.status === 'ready' ? 'complete' : stage?.status === 'blocked' ? 'blocked' : 'incomplete'} />
            <span className="text-sm tabular-nums" data-testid="text-progress">{summary.data ? `${summary.data.evaluation.passed}/${summary.data.evaluation.applicable} applicable checks passed` : 'Progress not evaluated'}</span>
          </div>
        </div>
        <div role="tablist" aria-label="Webinar workflow areas" className="mt-4 flex gap-1 overflow-x-auto">
          {areas.map((a) => (
            <button key={a.id} role="tab" type="button" aria-selected={area === a.id} aria-disabled={!!a.disabledReason || undefined} aria-describedby={a.disabledReason ? `ww-area-${a.id}-why` : undefined}
              className={`ww-target shrink-0 rounded-md border px-3 text-sm font-medium ${area === a.id ? 'border-[hsl(var(--ww-green-600))] bg-card text-[hsl(var(--ww-green-900))]' : 'border-transparent'} ${a.disabledReason ? 'cursor-not-allowed text-muted-foreground' : ''}`}
              onClick={() => goArea(a.id)} data-testid={`area-${a.id}`}>
              <span className="inline-flex items-center gap-1">{a.disabledReason && <Lock aria-hidden="true" className="h-3.5 w-3.5" />}{a.label}</span>
              {a.disabledReason && <span id={`ww-area-${a.id}-why`} className="block text-[11px] font-normal">{a.disabledReason}</span>}
            </button>
          ))}
        </div>
      </header>

      {(conflict || serverNewer) && (
        <div role="alert" className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[hsl(32_70%_70%)] bg-[hsl(var(--ww-amber-100))] p-3 text-sm text-[hsl(var(--ww-amber-800))] sm:mx-6" data-testid="banner-conflict">
          <span>{conflict ? 'A newer version was saved elsewhere. Nothing was overwritten, and your edits are still here.' : 'A newer version exists on the server. Your unsaved edits are kept.'}</span>
          <Button type="button" size="sm" variant="outline" className="ww-target" onClick={() => void reloadLatest()}>Load latest (discards my edits)</Button>
        </div>
      )}
      {standardIneligible && (
        <div className="mx-4 mt-3 sm:mx-6" data-testid="status-ineligible"><RegionError title={standardIneligible.kind === 'not_found' || standardIneligible.kind === 'validation' ? 'This occurrence is not eligible for the webinar standard workspace' : standardIneligible.title} message={standardIneligible.message} nextAction="Only eligible synthetic webinar occurrences can use guided Setup and Recruitment. Session details below remain viewable." onRetry={standardIneligible.retrySafe ? () => void summary.refetch() : undefined} /></div>
      )}

      <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <div className="mb-3 lg:hidden">
            <Sheet>
              <SheetTrigger asChild><Button type="button" variant="outline" className="ww-target w-full justify-between"><span className="inline-flex items-center gap-2"><ListChecks aria-hidden="true" className="h-4 w-4" />Tasks and status</span><StatusChip label={FRESHNESS_LABEL[fresh]} /></Button></SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
                <SheetHeader><SheetTitle>Tasks and status</SheetTitle><SheetDescription>Next action, critical issues, and evaluation freshness.</SheetDescription></SheetHeader>
                <div className="mt-3">{renderTaskPanel('mobile')}</div>
              </SheetContent>
            </Sheet>
          </div>

          {area === 'setup' && (
            <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
              <nav aria-label="Setup steps">
                <ol className="flex gap-1 overflow-x-auto md:flex-col" data-testid="stepper">
                  {SETUP_STEPS.map((st, i) => {
                    const Icon = STEP_ICON[st.id];
                    const status = st.id === 'review' ? null : stepStatus(st.id, stage, stepDirty(st.id));
                    return (
                      <li key={st.id} className="shrink-0">
                        <button type="button" aria-current={step === st.id ? 'step' : undefined} onClick={() => goStep(st.id)} className="ww-step ww-target flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm" data-testid={`step-${st.id}`}>
                          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                          <span className="min-w-0"><span className="block font-medium">{i + 1}. {st.label}</span>{status && <span className="hidden text-[11px] text-muted-foreground md:block">{status}</span>}</span>
                          <span className="sr-only">{step === st.id ? ', current step' : ''}{status ? `, ${status}` : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </nav>
              <section className="ww-panel ww-reveal min-w-0 p-4 sm:p-5" key={step} aria-label={`Setup step: ${SETUP_STEPS[stepIndex].label}`}>
                <ErrorSummary errors={errors} serverError={serverError} summaryRef={summaryRef} onRetry={lastAttempt.current ?? undefined} />
                {!stepProps ? <Skeleton className="h-64 w-full" /> : (
                  <div className="mt-2">
                    {step === 'why' && <WhyStep {...stepProps} />}
                    {step === 'who' && <WhoStep {...stepProps} />}
                    {step === 'what' && <WhatStep {...stepProps} />}
                    {step === 'when' && <WhenStep {...stepProps} impact={null} />}
                    {step === 'where' && <WhereStep {...stepProps} />}
                    {step === 'how' && <HowStep {...stepProps} />}
                    {step === 'review' && <ReviewStep {...stepProps} dirtySteps={dirtySteps} />}
                  </div>
                )}
                <SaveBar
                  dirty={stepDirty(step)} saving={updateWebinar.isPending || updateStandard.isPending || preview.isPending}
                  onSave={EDITABLE_STEPS.includes(step) ? () => saveStep(false) : undefined}
                  onBack={prevStep} onNext={() => (step === 'review' ? goArea('recruitment') : EDITABLE_STEPS.includes(step) ? saveStep(true) : nextStep())}
                  canBack={stepIndex > 0} canNext={!conflict} lastSaved={lastSaved}
                  label={step === 'review' ? 'Continue to Recruitment' : EDITABLE_STEPS.includes(step) && stepDirty(step) ? 'Save and continue' : 'Continue'}
                />
              </section>
            </div>
          )}

          {area === 'recruitment' && (
            standard.isPending ? <Skeleton className="h-96 w-full" /> : standard.isError || !standard.data ? (
              <RegionError title="Recruitment plan unavailable" message={classifyError(standard.error).message} nextAction={classifyError(standard.error).nextAction} onRetry={() => void standard.refetch()} />
            ) : (
              <div className="space-y-4">
                <RecruitmentView standard={standard.data} session={s} stage={stage} summary={summary.data} overdueSource={overdueSource} onJumpSetup={(x) => { setArea('setup'); setStep(x); }} />
                <div className="grid gap-4 xl:grid-cols-2">
                  <EvidencePanel campaignId={campaignId} sessionId={sessionId} evidence={evidence.data} timezone={tz} announce={announce} />
                  <ExceptionPanel campaignId={campaignId} sessionId={sessionId} exceptions={exceptions.data} blockers={stage?.unresolvedBlockingFailures ?? []} nonblocking={[...(stage?.warnings ?? []), ...(stage?.nonblockingFailures ?? [])]} evidence={evidence.data} timezone={tz} announce={announce} />
                </div>
                <HistoryList records={history.data?.records} timezone={tz} />
              </div>
            )
          )}

          {area === 'readiness' && (
            <section className="ww-panel p-5" data-testid="panel-readiness-summary" aria-labelledby="ww-rd-h">
              <h2 id="ww-rd-h" className="text-lg font-semibold">Readiness summary</h2>
              <p className="mt-1 text-sm text-muted-foreground">A concise status from the last simulation evaluation. The full Readiness workflow is not built in this phase.</p>
              {readiness.isError ? <div className="mt-3"><RegionError title="Readiness unavailable" nextAction={classifyError(readiness.error).nextAction} onRetry={() => void readiness.refetch()} /></div> : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(readiness.data?.stages ?? []).map((st) => <li key={st.stage} className="flex items-center justify-between rounded-md border border-border p-3 text-sm"><span>{st.stage} <span className="block text-xs text-muted-foreground">Simulation readiness · non-operational</span></span><StatusChip label={simulationReadinessText(st)} /></li>)}
                  {readiness.data && readiness.data.stages.length === 0 && <li className="text-sm text-muted-foreground">Not evaluated.</li>}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted-foreground">Simulation-only: not operational readiness.</p>
            </section>
          )}
        </div>
        <aside className="hidden lg:block" aria-label="Tasks and status"><div className="ww-panel sticky top-4 p-4">{renderTaskPanel('desktop')}</div></aside>
      </div>

      <AlertDialog open={!!pendingNav} onOpenChange={(o) => { if (!o) setPendingNav(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved changes{pendingNav?.kind === 'step' ? ` in ${SETUP_STEPS[stepIndex].label}` : ''}. Leaving discards them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="ww-target">Keep editing</AlertDialogCancel>
            <AlertDialogAction className="ww-target" onClick={() => { const nav = pendingNav; setPendingNav(null); if (!nav) return; if (nav.kind === 'step') { if (base) setDraft(base); if (vBase) setVariants(vBase); setErrors({}); } else discardAll(); completeNav(nav); }} data-testid="button-discard">Discard changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={impactOpen} onOpenChange={(o) => { if (!o && !updateWebinar.isPending) { setImpactOpen(false); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Confirm date change</DialogTitle>
            <DialogDescription>Review how the new timing affects planned communications. Saving marks earlier results stale and runs a new simulation evaluation.</DialogDescription>
          </DialogHeader>
          {impact && <DateImpactList impact={impact} />}
          {impact && !summarizeDateImpact(impact).requiresConfirmation && <p className="text-sm">No planned communication changes.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" className="ww-target" onClick={() => setImpactOpen(false)} disabled={updateWebinar.isPending}>Keep editing</Button>
            <Button type="button" className="ww-target" onClick={confirmDateSave} disabled={updateWebinar.isPending} data-testid="button-confirm-date">{updateWebinar.isPending ? 'Saving…' : 'Save and re-evaluate'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WorkspaceSkeleton() {
  return (
    <section className="p-6" aria-busy="true" aria-label="Loading webinar workspace">
      <Skeleton className="h-6 w-72" /><Skeleton className="mt-3 h-9 w-96 max-w-full" /><Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_17rem]"><Skeleton className="h-72" /><Skeleton className="h-[28rem]" /><Skeleton className="hidden h-72 lg:block" /></div>
    </section>
  );
}
