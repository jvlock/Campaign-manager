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
