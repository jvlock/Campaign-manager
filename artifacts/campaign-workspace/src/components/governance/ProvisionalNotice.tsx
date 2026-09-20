import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PROVISIONAL_LABEL = 'Provisional — not governance-approved';

export function ProvisionalBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
        className,
      )}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      {PROVISIONAL_LABEL}
    </span>
  );
}

export function ProvisionalNotice({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-md border border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100',
        compact ? 'p-2 text-xs' : 'p-4 text-sm',
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={cn('mt-0.5 shrink-0', compact ? 'h-3.5 w-3.5' : 'h-5 w-5')} aria-hidden="true" />
        <div>
          <div className="font-semibold">{PROVISIONAL_LABEL}</div>
          <p className={cn('text-amber-900/80 dark:text-amber-100/80', compact ? 'mt-0.5' : 'mt-1')}>
            Campaign Governance Foundation source data is quarantined pending security remediation and business validation.
            Preview codes, names, tags, and UTMs may be saved as drafts, but final issuance, governance approval, and external publishing are unavailable.
          </p>
        </div>
      </div>
    </div>
  );
}