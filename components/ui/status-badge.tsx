'use client';

import { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Semantic tones for status badges, mapped to theme tokens so badges stay
 * consistent (and theme-aware) across dashboard pages. Use these instead of
 * raw palette classes like bg-green-500/10.
 */
export type StatusTone =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'accent'
  | 'violet'
  | 'neutral'
  | 'muted';

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-status-success/10 text-status-success border-status-success/20',
  warning: 'bg-status-warning/10 text-status-warning border-status-warning/20',
  error: 'bg-status-error/10 text-status-error border-status-error/20',
  info: 'bg-status-info/10 text-status-info border-status-info/20',
  accent: 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/20',
  violet: 'bg-accent-violet/10 text-accent-violet border-accent-violet/20',
  neutral: 'bg-overlay/5 text-text-muted border-overlay/10',
  muted: 'bg-overlay/5 text-text-muted/70 border-overlay/10',
};

export function getStatusToneClasses(tone: StatusTone): string {
  return toneClasses[tone];
}

interface StatusBadgeProps {
  tone?: StatusTone;
  icon?: LucideIcon;
  iconClassName?: string;
  children: ReactNode;
  className?: string;
}

export function StatusBadge({ tone = 'neutral', icon: Icon, iconClassName, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        toneClasses[tone],
        className
      )}
    >
      {Icon ? <Icon className={cn('h-3.5 w-3.5', iconClassName)} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
