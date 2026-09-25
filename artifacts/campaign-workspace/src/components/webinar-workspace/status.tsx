import type { ReactNode } from 'react';
import {
  CheckCircle2, AlertTriangle, XOctagon, CircleDashed, Info, Lock, FlaskConical, RefreshCw, CalendarClock, Loader2, HelpCircle,
} from 'lucide-react';
import type { WebinarApiFoundationOutput } from '@workspace/api-client-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  TONE_FOR_LABEL, CAPABILITY_LABEL, CAPABILITY_NAME, capabilityState,
  type StatusLabel, type StatusTone, type CapabilityState,
} from '@/lib/webinar-workspace/adapters';

const TONE_CLASS: Record<StatusTone, string> = {
  complete: 'ww-tone-complete',
  attention: 'ww-tone-attention',
  blocked: 'ww-tone-blocked',
  incomplete: 'ww-tone-incomplete',
  info: 'ww-tone-info',
  unavailable: 'ww-tone-unavailable',
  simulation: 'ww-tone-simulation',
  stale: 'ww-tone-attention',
  planned: 'ww-tone-planned',
};

const TONE_ICON: Record<StatusTone, typeof Info> = {
  complete: CheckCircle2, attention: AlertTriangle, blocked: XOctagon, incomplete: CircleDashed,
  info: Info, unavailable: Lock, simulation: FlaskConical, stale: RefreshCw, planned: CalendarClock,
};

/** Status is always icon + text; color is supplementary. */
export function StatusChip({ label, tone, className, testId }: { label: StatusLabel | string; tone?: StatusTone; className?: string; testId?: string }) {
  const t: StatusTone = tone ?? TONE_FOR_LABEL[label as StatusLabel] ?? 'info';
  const Icon = TONE_ICON[t];
  return (
    <span data-testid={testId} data-tone={t} className={cn('ww-chip', TONE_CLASS[t], className)}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function SimulationBadge({ className }: { className?: string }) {
  return (
    <ExplainTerm term="Simulation" explanation="Synthetic, development-only data. It validates the workflow but is not live Foundation output, not operational approval, and nothing is sent.">
      <StatusChip label="Simulation" tone="simulation" className={className} testId="badge-simulation" />
    </ExplainTerm>
  );
}

/**
 * Accessible explanation: a real button opens a popover on click/tap/keyboard
 * (touch equivalent) and a tooltip on hover/focus. Content is never hover-only.
 */
export function ExplainTerm({ term, explanation, children }: { term: string; explanation: string; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button type="button" className="ww-help" aria-label={`What does “${term}” mean?`}>
                <HelpCircle aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
        </Tooltip>
        <PopoverContent className="max-w-xs text-sm" role="note">
          <p className="font-semibold">{term}</p>
          <p className="mt-1 text-muted-foreground">{explanation}</p>
        </PopoverContent>
      </Popover>
    </span>
  );
}

const CAPABILITY_TONE: Record<CapabilityState, StatusTone> = {
  'available-synthetic': 'simulation', 'available-live': 'complete', configured_but_unavailable: 'attention',
  not_configured: 'unavailable', unsupported: 'unavailable', invalid_response: 'blocked', stale: 'stale',
  refreshing: 'info', refresh_failed: 'blocked',
};

const CAPABILITY_EXPLAIN: Record<CapabilityState, string> = {
  'available-synthetic': 'Returned by the synthetic development provider. It validates the workflow but is not authoritative live Foundation output.',
  'available-live': 'Returned by a live provider.',
  configured_but_unavailable: 'A provider is configured, but no valid response was available. Configured does not mean connected.',
  not_configured: 'No provider is set up for this output. There is nothing to retry.',
  unsupported: 'The Foundation does not supply this governed output yet. No value is shown and none is inferred.',
  invalid_response: 'The provider responded, but the response failed validation and was not used.',
  stale: 'A prior observation exists but is out of date for the current inputs.',
  refreshing: 'A refresh request is in progress.',
  refresh_failed: 'The last refresh did not complete. Earlier observations remain as they were.',
};

/** Reusable governed-capability status. Never renders an unavailable output as blank success. */
export function CapabilityStatus({ type, output, refreshing, refreshFailed, compact }: {
  type: WebinarApiFoundationOutput['type'];
  output?: Pick<WebinarApiFoundationOutput, 'status' | 'availableFromRealProvider' | 'error' | 'taxonomyVersion' | 'createdAt'>;
  refreshing?: boolean;
  refreshFailed?: boolean;
  compact?: boolean;
}) {
  const state = capabilityState(output, { refreshing, refreshFailed });
  const name = CAPABILITY_NAME[type];
  return (
    <div className={cn('ww-capability', compact && 'ww-capability-compact')} data-testid={`capability-${type}`} data-state={state}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{name}</span>
        {refreshing ? (
          <span className="ww-chip ww-tone-info"><Loader2 aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" />{CAPABILITY_LABEL[state]}</span>
        ) : (
          <StatusChip label={CAPABILITY_LABEL[state]} tone={CAPABILITY_TONE[state]} />
        )}
        {state === 'available-synthetic' && <SimulationBadge />}
        <ExplainTerm term={CAPABILITY_LABEL[state]} explanation={CAPABILITY_EXPLAIN[state]} />
      </div>
      {!compact && (
        <p className="mt-1 text-xs text-muted-foreground">
          {state === 'available-synthetic' && output?.taxonomyVersion ? `Synthetic taxonomy version ${output.taxonomyVersion}. ` : ''}
          {state === 'unsupported' || state === 'not_configured' ? 'Not Foundation governed — no value available.' : ''}
          {output?.error && state !== 'unsupported' ? ` ${output.error}` : ''}
        </p>
      )}
    </div>
  );
}

export function RegionError({ title, message, nextAction, onRetry, testId }: { title: string; message?: string; nextAction: string; onRetry?: () => void; testId?: string }) {
  return (
    <div role="alert" className="ww-region-error" data-testid={testId}>
      <XOctagon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        {message && <p className="mt-0.5 break-words text-sm">{message}</p>}
        <p className="mt-1 text-sm">{nextAction}</p>
        {onRetry && <button type="button" className="ww-link-btn mt-2" onClick={onRetry}>Retry</button>}
      </div>
    </div>
  );
}
