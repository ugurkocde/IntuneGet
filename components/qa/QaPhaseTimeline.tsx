'use client';

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QaLivePhase } from '@/types/qa';

const PHASES: Array<{ id: QaLivePhase; label: string }> = [
  { id: 'preparing_package', label: 'Preparing package' },
  { id: 'restoring_vm', label: 'Restoring golden VM' },
  { id: 'installing', label: 'Installing' },
  { id: 'detecting_install', label: 'Testing detection' },
  { id: 'uninstalling', label: 'Uninstalling' },
  { id: 'verifying_removal', label: 'Verifying removal' },
  { id: 'publishing', label: 'Publishing result' },
];

export function QaPhaseTimeline({ currentPhase }: { currentPhase: QaLivePhase }) {
  const currentIndex = Math.max(0, PHASES.findIndex((item) => item.id === currentPhase));

  return (
    <ol aria-label="QA test progress" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
      {PHASES.map((item, index) => {
        const complete = index < currentIndex;
        const active = index === currentIndex;
        const Icon = complete ? CheckCircle2 : active ? Loader2 : Circle;
        return (
          <li
            key={item.id}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex min-h-16 items-center gap-2 rounded-xl border px-3 py-2 text-xs',
              complete && 'border-status-success/20 bg-status-success/5 text-status-success',
              active && 'border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan',
              !complete && !active && 'border-overlay/10 bg-overlay/[0.02] text-text-muted'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', active && 'animate-spin')} aria-hidden="true" />
            <span className="font-medium leading-tight">{item.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
