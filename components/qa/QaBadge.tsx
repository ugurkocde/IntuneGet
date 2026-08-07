'use client';

import { useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { getStatusToneClasses } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import { deriveQaBadgeState } from '@/lib/qa/status';
import type { QaStatus } from '@/types/qa';
import { QaDetailsDialog } from './QaDetailsDialog';

interface QaBadgeProps {
  wingetId: string;
  catalogVersion: string;
  status?: QaStatus | null;
}

export function QaBadge({ wingetId, catalogVersion, status }: QaBadgeProps) {
  const [open, setOpen] = useState(false);
  const state = deriveQaBadgeState(status, catalogVersion);
  if (!status || state === 'untested') return null;

  const stale = state === 'stale_passed' || state === 'stale_failed';
  const failed = state === 'failed' || state === 'stale_failed';
  const Icon = stale ? ShieldAlert : failed ? ShieldX : ShieldCheck;
  const label = stale
    ? `QA ${failed ? 'Failed' : 'Passed'} v${status.testedVersion}`
    : `QA ${failed ? 'Failed' : 'Passed'}`;
  const ariaLabel = stale
    ? `QA result outdated. Tested version ${status.testedVersion}, catalog version ${catalogVersion}. View test details.`
    : `QA ${failed ? 'failed' : 'passed'} on version ${status.testedVersion}. View test details.`;

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
        }}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated',
          getStatusToneClasses(stale ? 'warning' : failed ? 'error' : 'success')
        )}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </button>
      <QaDetailsDialog
        wingetId={wingetId}
        catalogVersion={catalogVersion}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
