'use client';

import { CheckCircle2, AlertCircle, HelpCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MatchStatus } from '@/types/unmanaged';

interface MatchStatusBadgeProps {
  status: MatchStatus;
  confidence?: number | null;
  className?: string;
}

const statusConfig: Record<MatchStatus, {
  label: string;
  icon: typeof CheckCircle2;
  colors: string;
}> = {
  matched: {
    label: 'Matched',
    icon: CheckCircle2,
    colors: 'bg-status-success/10 text-status-success border-status-success/20',
  },
  partial: {
    label: 'Partial Match',
    icon: AlertCircle,
    colors: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  unmatched: {
    label: 'No Match',
    icon: HelpCircle,
    colors: 'bg-black/5 text-text-muted border-black/10',
  },
  pending: {
    label: 'Pending',
    icon: Clock,
    colors: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
};

export function MatchStatusBadge({ status, confidence, className }: MatchStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
        config.colors,
        className
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{config.label}</span>
      {confidence !== null && confidence !== undefined && status !== 'unmatched' && (
        <span className="opacity-70">({Math.round(confidence * 100)}%)</span>
      )}
    </span>
  );
}
