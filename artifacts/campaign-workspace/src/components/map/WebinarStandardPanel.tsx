import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getExportWebinarStandardQueryOptions,
  getGetWebinarStandardEligibilityQueryOptions,
  getGetWebinarStandardQueryOptions,
  getGetWebinarStandardQueryKey,
  getListWebinarPeopleQueryOptions,
  type WebinarStandard,
  type WebinarStandardContent,
  type WebinarStandardEligibilityRow,
  type WebinarStandardPatch,
  type WebinarStandardVariant,
  useGetWebinarStandard,
  useGetWebinarStandardEligibility,
  useListWebinarPeople,
  useGetDevelopmentStatus,
  useUpdateWebinarStandard,
} from '@workspace/api-client-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Layers, Download, Loader2, CheckCircle2, AlertCircle, ChevronDown, Save, Users } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

import { CommunicationDeliverablesEditor } from '../delivery/CommunicationDeliverablesEditor';
import { ProvisionalBadge } from '../governance/ProvisionalNotice';

type ContentField = keyof WebinarStandardContent;
type LocalValidation = { valid: boolean; message?: string };

const contentFields: Array<{ key: ContentField; label: string; multiline?: boolean }> = [
  { key: 'subject', label: 'Subject' },
  { key: 'preheader', label: 'Preheader' },
  { key: 'hero', label: 'Hero Image/Text' },
  { key: 'body', label: 'Body', multiline: true },
  { key: 'internalAssetName', label: 'Internal Asset Name' },
];

const pilotLimitFields: Array<{ key: ContentField; label: string }> = [
  { key: 'subject', label: 'Subject' },
  { key: 'preheader', label: 'Preheader' },
  { key: 'hero', label: 'Hero' },
  { key: 'body', label: 'Body' },
  { key: 'ctaLabel', label: 'CTA label' },
  { key: 'ctaUrl', label: 'CTA URL' },
  { key: 'internalAssetName', label: 'Internal asset name' },
];

function emptyContent(): WebinarStandardContent {
  return {
    subject: '',
    preheader: '',
    hero: '',
    body: '',
    ctaLabel: '',
    ctaUrl: '',
    internalAssetName: '',
  };
}

function unicodeLength(value: string) {
  return Array.from(value || '').length;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'The webinar standard could not be saved.';
}

function errorPayload(error: unknown): { error?: string; errors?: Array<{ key: string; slot: number; field: string; message: string }> } {
  if (!error || typeof error !== 'object' || !('data' in error)) return {};
  const data = error.data;
  if (!data || typeof data !== 'object') return {};
  const value = data as Record<string, unknown>;
  return {
    error: typeof value.error === 'string' ? value.error : undefined,
    errors: Array.isArray(value.errors)
      ? value.errors.filter((item): item is { key: string; slot: number; field: string; message: string } => (
        Boolean(item)
        && typeof item === 'object'
        && typeof (item as Record<string, unknown>).key === 'string'
        && typeof (item as Record<string, unknown>).slot === 'number'
        && typeof (item as Record<string, unknown>).field === 'string'
        && typeof (item as Record<string, unknown>).message === 'string'
      ))
      : undefined,
  };
}

function payloadFor(data: WebinarStandard): WebinarStandardPatch {
  return {
    ...(data.launchAt ? { launchAt: data.launchAt } : {}),
    templateConfig: {
      pilotLimits: { ...data.templateConfig.pilotLimits },
      variants: data.templateConfig.variants.map((variant) => ({ ...variant })),
    },
    communications: data.communications.map((communication) => ({
      key: communication.key,
      status: communication.status,
      variants: communication.variants.map((variant) => ({
        slot: variant.slot,
        content: { ...variant.content },
      })),
    })),
  };
}

function validationFor(
  value: string,
  limit: number,
  active: boolean,
): LocalValidation {
  const length = unicodeLength(value);
  if (active && length === 0) return { valid: false, message: 'Required for active variant' };
  if (length > limit) return { valid: false, message: `Must be at most ${limit} characters` };
  return { valid: true };
}

function CopyField({
  label,
  value,
  limit,
  validation,
  onChange,
  multiline = false,
  required,
}: {
  label: string;
  value: string;
  limit: number;
  validation: LocalValidation;
  onChange: (value: string) => void;
  multiline?: boolean;
  required: boolean;
}) {
  const length = unicodeLength(value);
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center gap-2 text-xs">
        <Label className={validation.valid ? 'text-muted-foreground' : 'text-destructive'}>
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
        <span className={validation.valid ? 'text-emerald-600 font-medium' : 'text-destructive font-bold'}>
          {validation.valid ? 'PASS' : 'FAIL'} · {length} / {limit}
        </span>
      </div>
      {validation.message && <p className="text-[10px] text-destructive">{validation.message}</p>}
      {multiline ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`text-sm min-h-[100px] ${validation.valid ? '' : 'border-destructive focus-visible:ring-destructive'}`}
        />
      ) : (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`h-8 text-sm ${validation.valid ? '' : 'border-destructive focus-visible:ring-destructive'}`}
        />
      )}
    </div>
  );
}

function formatTiming(communication: WebinarStandard['communications'][number]) {
  if (communication.timing.kind === 'trigger') return 'Trigger: Immediate';
  return `${communication.timing.offset} ${communication.timing.unit} ${communication.timing.direction}`;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : 'Pending';
}

function rowsForPerson(rows: WebinarStandardEligibilityRow[], personId: string) {
  return rows.filter((row) => row.personId === personId);
}

export default function WebinarStandardPanel({
  campaignId,
  sessionId,
  sessionName,
  onDirtyChange,
}: {
  campaignId: string;
  sessionId: string;
  sessionName: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localData, setLocalData] = useState<WebinarStandard | null>(null);
  const localDataRef = useRef<WebinarStandard | null>(null);
  const [latestServerData, setLatestServerData] = useState<WebinarStandard | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [exportError, setExportError] = useState<{ error?: string; errors?: Array<{ key: string; slot: number; field: string; message: string }> } | null>(null);
  const initializedForId = useRef<string | null>(null);
  const baselineRef = useRef('');
  const editVersionRef = useRef(0);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const standardQuery = useGetWebinarStandard(campaignId, sessionId, {
    query: {
      ...getGetWebinarStandardQueryOptions(campaignId, sessionId),
      enabled: Boolean(campaignId && sessionId),
    },
  });
  const eligibilityQuery = useGetWebinarStandardEligibility(campaignId, sessionId, {
    query: {
      ...getGetWebinarStandardEligibilityQueryOptions(campaignId, sessionId),
      enabled: Boolean(campaignId && sessionId),
    },
  });
  // Same query key as App's PlanningAccess, so this reads the cached server mode.
  const devStatus = useGetDevelopmentStatus({ query: { queryKey: ['development-status'], retry: false } });
  const openDevelopment = devStatus.data?.mode === 'open-development';
  const peopleQuery = useListWebinarPeople(campaignId, sessionId, {
    query: {
      ...getListWebinarPeopleQueryOptions(campaignId, sessionId),
      // GET .../webinars/:sessionId/people is not on the open-development allowlist (403): skip it only in that mode.
      enabled: Boolean(campaignId && sessionId) && devStatus.isSuccess && !openDevelopment,
    },
  });
  const updateStandard = useUpdateWebinarStandard();

  const setDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    initializedForId.current = null;
    localDataRef.current = null;
    setLocalData(null);
    setLatestServerData(null);
    baselineRef.current = '';
    editVersionRef.current = 0;
    setDirty(false);
  }, [sessionId, setDirty]);

  useEffect(() => {
    const data = standardQuery.data;
    if (!data) return;
    setLatestServerData(data);
    if (initializedForId.current !== sessionId) {
      initializedForId.current = sessionId;
      localDataRef.current = data;
      setLocalData(data);
      baselineRef.current = JSON.stringify(payloadFor(data));
      setDirty(false);
      return;
    }
    // Session edits can recompute dates while copy is being edited. Keep the
    // draft intact, but retain this response for the schedule column below.
    if (!isDirtyRef.current && !isSavingRef.current) {
      localDataRef.current = data;
      setLocalData(data);
      baselineRef.current = JSON.stringify(payloadFor(data));
      setDirty(false);
    }
  }, [sessionId, setDirty, standardQuery.data]);

  const updateLocal = useCallback((updater: (current: WebinarStandard) => WebinarStandard) => {
    const current = localDataRef.current;
    if (!current) return;
    const next = updater(current);
    localDataRef.current = next;
    editVersionRef.current += 1;
    setDirty(JSON.stringify(payloadFor(next)) !== baselineRef.current);
    setLocalData(next);
  }, [setDirty]);

  const saveDrafts = useCallback((): Promise<boolean> => {
    const current = localDataRef.current;
    if (!current) return Promise.resolve(false);
    const requestedVersion = editVersionRef.current;
    const requestedPayload = payloadFor(current);
    if (!isDirtyRef.current && !isSavingRef.current) return Promise.resolve(true);

    setSaveError('');
    setIsSaving(true);
    isSavingRef.current = true;
    const save = saveQueueRef.current
      .catch(() => false)
      .then(async () => {
        try {
          const saved = await updateStandard.mutateAsync({
            id: campaignId,
            sessionId,
            data: requestedPayload,
          });
          queryClient.setQueryData(getGetWebinarStandardQueryKey(campaignId, sessionId), saved);
          // The response belongs to requestedPayload. Never replace a newer
          // local snapshot with an older response.
          baselineRef.current = JSON.stringify(requestedPayload);
          if (editVersionRef.current === requestedVersion) {
            localDataRef.current = saved;
            setLocalData(saved);
            baselineRef.current = JSON.stringify(payloadFor(saved));
            setDirty(false);
          } else if (localDataRef.current) {
            setDirty(JSON.stringify(payloadFor(localDataRef.current)) !== baselineRef.current);
          }
          setSaveError('');
          return true;
        } catch (error) {
          setSaveError(errorMessage(error));
          return false;
        } finally {
          isSavingRef.current = false;
          setIsSaving(false);
        }
      });
    saveQueueRef.current = save;
    return save;
  }, [campaignId, queryClient, sessionId, setDirty, updateStandard]);

  const handleExport = async () => {
    setExportError(null);
    const saved = await saveDrafts();
    if (!saved) return;
    try {
      const exportData = await queryClient.fetchQuery(
        getExportWebinarStandardQueryOptions(campaignId, sessionId),
      );
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `webinar-${sessionId}-export.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      const details = errorPayload(error);
      if (details.errors) {
        setExportError(details);
      } else {
        toast({ title: 'Export failed', description: errorMessage(error), variant: 'destructive' });
      }
    }
  };

  const generateName = (communicationKey: string, variantName: string) => (
    `${sessionName}-${communicationKey}-${variantName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  );

  const addVariant = () => {
    if (!localData || localData.templateConfig.variants.length >= 4) return;
    const slots = new Set(localData.templateConfig.variants.map((variant) => variant.slot));
    const slot = [1, 2, 3, 4].find((candidate) => !slots.has(candidate));
    if (!slot) return;
    const variant: WebinarStandardVariant = {
      slot,
      name: `Variant ${slot}`,
      inUse: false,
      audienceDefinition: '',
      messageAngle: '',
      valueProposition: '',
    };
    updateLocal((current) => ({
      ...current,
      templateConfig: {
        ...current.templateConfig,
        variants: [...current.templateConfig.variants, variant].sort((a, b) => a.slot - b.slot),
      },
      communications: current.communications.map((communication) => ({
        ...communication,
        variants: [...communication.variants, {
          slot,
          content: emptyContent(),
          validation: { valid: true, errors: [] },
        }],
      })),
    }));
  };

  if (standardQuery.isError) {
    return (
      <div className="p-4 text-sm text-destructive border border-destructive/30 rounded-md bg-destructive/5">
        Unable to load webinar standard: {errorMessage(standardQuery.error)}
      </div>
    );
  }

  if (standardQuery.isLoading || !localData) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
        Loading standard communications...
      </div>
    );
  }

  const activeVariantCount = localData.templateConfig.variants.filter((variant) => variant.inUse).length;
  const scheduleData = latestServerData ?? localData;
  const people = peopleQuery.data ?? [];
  const eligibilityRows = eligibilityQuery.data?.people ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          {localData.templateName}
        </h3>
        <p className="text-xs text-muted-foreground mt-2">{localData.templateSummary}</p>
        <p className="text-xs text-muted-foreground mt-2">
          {localData.templateId === 'webinar_legacy_9'
            ? 'This existing webinar keeps its original sequence. New webinars use the five-message template.'
            : 'Created from the default webinar template. Customize each message and audience variant below.'}
          {' '}These are planning drafts; emails are not sent automatically.
        </p>
      </div>
      <div className="bg-card border border-border rounded-md shadow-sm p-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Campaign Launch</h3>
          <p className="text-xs text-muted-foreground mt-1">Recruitment starts on this date. Earlier instances are skipped.</p>
        </div>
        <Input
          type="datetime-local"
          className="h-8 text-xs w-48"
          value={localData.launchAt ? new Date(localData.launchAt).toISOString().slice(0, 16) : ''}
          onChange={(event) => {
            if (!event.target.value) return;
            updateLocal((current) => ({ ...current, launchAt: new Date(event.target.value).toISOString() }));
          }}
        />
      </div>

      <div className="bg-card border border-border rounded-md shadow-sm p-4">
        <div className="flex justify-between items-center gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" /> Variant Configuration
            </h3>
            <p className="text-xs text-muted-foreground mt-1">Configurable pilot governance limits — not platform limits.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{activeVariantCount} active · {localData.templateConfig.variants.length}/4 slots</span>
            {localData.templateConfig.variants.length < 4 && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addVariant}>Add slot</Button>
            )}
          </div>
        </div>

        <Collapsible open={limitsOpen} onOpenChange={setLimitsOpen} className="mb-4 rounded border border-border bg-muted/20">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full h-8 justify-between px-2 text-xs">
              Pilot character limits
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${limitsOpen ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t border-border p-2">
            <div className="grid grid-cols-2 gap-2">
              {pilotLimitFields.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{label}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={localData.templateConfig.pilotLimits[key]}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (!Number.isInteger(value) || value < 1) return;
                      updateLocal((current) => ({
                        ...current,
                        templateConfig: {
                          ...current.templateConfig,
                          pilotLimits: { ...current.templateConfig.pilotLimits, [key]: value },
                        },
                      }));
                    }}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div className="space-y-4">
          {localData.templateConfig.variants.map((variant) => (
            <div key={variant.slot} className="p-3 border rounded-md bg-muted/10">
              <div className="flex items-center justify-between mb-3 gap-3">
                <div className="font-semibold text-sm text-foreground">Slot {variant.slot}</div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={variant.inUse}
                    disabled={variant.inUse && activeVariantCount === 1}
                    onCheckedChange={(inUse) => {
                      if (!inUse && activeVariantCount === 1) {
                        toast({ title: 'Keep at least one active variant', variant: 'destructive' });
                        return;
                      }
                      updateLocal((current) => ({
                        ...current,
                        templateConfig: {
                          ...current.templateConfig,
                          variants: current.templateConfig.variants.map((candidate) => (
                            candidate.slot === variant.slot ? { ...candidate, inUse } : candidate
                          )),
                        },
                      }));
                    }}
                  />
                  <Label className="text-xs font-medium">{variant.inUse ? 'Active' : 'Inactive'}</Label>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {([
                  ['name', 'Name'],
                  ['audienceDefinition', 'Audience Definition'],
                  ['messageAngle', 'Message Angle'],
                  ['valueProposition', 'Value Proposition'],
                ] as const).map(([field, label]) => {
                  const value = variant[field];
                  const valid = !variant.inUse || value.trim().length > 0;
                  return (
                    <div key={field} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <Label className="text-[10px] uppercase text-muted-foreground">{label}</Label>
                        <span className={`text-[10px] font-semibold ${valid ? 'text-emerald-600' : 'text-destructive'}`}>
                          {valid ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                      <Input
                        className="h-8 text-xs"
                        value={value}
                        onChange={(event) => updateLocal((current) => ({
                          ...current,
                          templateConfig: {
                            ...current.templateConfig,
                            variants: current.templateConfig.variants.map((candidate) => (
                              candidate.slot === variant.slot ? { ...candidate, [field]: event.target.value } : candidate
                            )),
                          },
                        }))}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          Standard Communications ({localData.communications.length})
        </h3>

        {localData.communications.map((communication) => {
          const scheduledCommunication = scheduleData.communications.find((candidate) => candidate.key === communication.key) ?? communication;
          const weekendAdjustment = communication.timing.weekendAdjustment && communication.timing.weekendAdjustment !== 'none'
            ? `Weekend: ${communication.timing.weekendAdjustment}`
            : '';
          return (
            <div key={communication.key} className="border border-border rounded-md overflow-hidden bg-card shadow-sm">
              <div className="bg-muted/30 p-3 border-b border-border">
                <div className="flex justify-between items-start gap-3">
                  <div>
                    <h4 className="font-semibold text-sm text-foreground">{communication.name}</h4>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {formatTiming(communication)} {weekendAdjustment && <span className="ml-2 text-primary/70">{weekendAdjustment}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">Audience: {communication.audienceRule}</div>
                  </div>
                  <div className="text-right shrink-0">
                    {scheduledCommunication.scheduled.status === 'skipped' ? (
                      <div className="text-xs text-amber-600 font-medium">Skipped: {scheduledCommunication.scheduled.skipReason || 'After launch date'}</div>
                    ) : communication.timing.kind === 'trigger' ? (
                      <div className="text-xs text-blue-600 font-medium">Triggered instantly</div>
                    ) : (
                      <div className="text-xs font-medium text-foreground">Scheduled: {formatDate(scheduledCommunication.scheduled.currentAt)}</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-3">
                <Tabs defaultValue={`slot-${localData.templateConfig.variants[0]?.slot ?? 1}`}>
                  <TabsList className="mb-3 flex-wrap h-auto">
                    {localData.templateConfig.variants.map((variant) => (
                      <TabsTrigger key={variant.slot} value={`slot-${variant.slot}`}>
                        {variant.name || `Variant ${variant.slot}`} {variant.inUse ? '' : '(Inactive)'}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {localData.templateConfig.variants.map((variant) => {
                    const variantData = communication.variants.find((candidate) => candidate.slot === variant.slot);
                    const content = variantData?.content ?? emptyContent();
                    const limits = localData.templateConfig.pilotLimits;
                    const updateContent = (field: ContentField, value: string) => {
                      updateLocal((current) => ({
                        ...current,
                        communications: current.communications.map((candidate) => candidate.key === communication.key
                          ? {
                            ...candidate,
                            variants: candidate.variants.map((candidateVariant) => candidateVariant.slot === variant.slot
                              ? { ...candidateVariant, content: { ...candidateVariant.content, [field]: value } }
                              : candidateVariant),
                          }
                          : candidate),
                      }));
                    };
                    return (
                      <TabsContent key={variant.slot} value={`slot-${variant.slot}`} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {contentFields.map(({ key, label, multiline }) => {
                            const validation = validationFor(content[key], limits[key], variant.inUse);
                            return (
                              <div key={key} className={key === 'hero' || key === 'body' || key === 'internalAssetName' ? 'col-span-full' : ''}>
                                <CopyField
                                  label={label}
                                  value={content[key]}
                                  limit={limits[key]}
                                  validation={validation}
                                  onChange={(value) => updateContent(key, value)}
                                  multiline={multiline}
                                  required={variant.inUse}
                                />
                                {key === 'internalAssetName' && (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      onClick={() => updateContent(key, generateName(communication.key, variant.name || `Variant ${variant.slot}`))}
                                    >
                                      Generate draft name
                                    </Button>
                                    {content[key] && <ProvisionalBadge />}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {(content.ctaLabel || content.ctaUrl) && (
                          <div className="mt-4 p-3 bg-muted/20 border border-border rounded-md">
                            <h5 className="text-xs font-semibold mb-2 flex items-center gap-1">Legacy CTA Data</h5>
                            <p className="text-[10px] text-muted-foreground mb-3">This data is preserved but no longer editable. Manage CTAs using the Deliverables Dependency editor below.</p>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label className="text-[10px] text-muted-foreground uppercase">Legacy CTA Label</Label>
                                <div className="text-sm font-medium">{content.ctaLabel || '-'}</div>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-muted-foreground uppercase">Legacy CTA URL</Label>
                                <div className="text-sm font-medium">{content.ctaUrl || '-'}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </TabsContent>
                    );
                  })}
                </Tabs>

                <CommunicationDeliverablesEditor
                  campaignId={campaignId}
                  communicationId={communication.id}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border pt-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs flex items-center gap-2">
            {saveError ? (
              <span className="text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Save failed: {saveError}</span>
            ) : isSaving ? (
              <span className="text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Saving drafts...</span>
            ) : isDirty ? (
              <span className="text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Unsaved draft changes</span>
            ) : (
              <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> All changes saved</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void saveDrafts()} disabled={!isDirty || isSaving} variant="outline" className="shrink-0">
              <Save className="w-4 h-4 mr-2" /> Save drafts
            </Button>
            <Button onClick={() => void handleExport()} disabled={isSaving} variant="default" className="shrink-0">
              <Download className="w-4 h-4 mr-2" /> Download provisional draft
            </Button>
          </div>
        </div>
      </div>

      {exportError && (
        <div className="p-4 border border-destructive bg-destructive/10 text-destructive rounded-md text-sm">
          <div className="font-bold flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4" /> {exportError.error || 'Active variant validation failed'}</div>
          {exportError.errors && (
            <ul className="list-disc list-inside space-y-1 text-xs text-destructive/90">
              {exportError.errors.map((error, index) => (
                <li key={`${error.key}-${error.slot}-${error.field}-${index}`}>
                  <span className="font-semibold">{error.key} (Slot {error.slot})</span> — {error.field}: {error.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="border border-border rounded-md bg-card p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Eligibility across nine communications</h3>
          <span className="text-[10px] text-muted-foreground">
            {eligibilityQuery.data?.externalSending === false ? 'Planning only · external sending disabled' : 'Loading planning status'}
          </span>
        </div>
        {eligibilityQuery.isLoading ? (
          <div className="text-xs text-muted-foreground">Loading seeded webinar people…</div>
        ) : people.length === 0 ? (
          <div className="text-xs text-muted-foreground">{openDevelopment ? 'Person list not requested: it is outside the open-development planning policy.' : 'No seeded webinar people are available for this session.'}</div>
        ) : (
          <div className="space-y-2">
            {people.map((person) => {
              const rows = rowsForPerson(eligibilityRows, person.id);
              return (
                <details key={person.id} className="rounded border border-border bg-muted/10 p-2">
                  <summary className="cursor-pointer text-xs font-medium">
                    {person.name} · {rows.filter((row) => row.eligible).length}/9 eligible
                  </summary>
                  <div className="mt-2 space-y-1">
                    {rows.map((row) => (
                      <div key={`${row.personId}-${row.communicationKey}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[10px]">
                        <span className="truncate">{row.communicationKey}: {row.reason}</span>
                        <span className={row.eligible ? 'text-emerald-600 font-semibold' : 'text-muted-foreground'}>{row.status}</span>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}