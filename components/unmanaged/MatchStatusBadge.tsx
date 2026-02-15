'use client';

import { CheckCircle2, AlertCircle, HelpCircle, Clock } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
    colors: 'bg-overlay/5 text-text-muted border-overlay/10',
  },
  pending: {
    label: 'Pending',
    icon: Clock,
    colors: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  },
};

function getConfidenceLabel(confidence: number): { label: string; color: string } {
  if (confidence >= 0.9) return { label: 'High', color: 'text-emerald-400' };
  if (confidence >= 0.7) return { label: 'Moderate', color: 'text-amber-400' };
  return { label: 'Low', color: 'text-red-400' };
}

function getConfidenceTooltip(status: MatchStatus, confidence: number | null | undefined): string {
  if (status === 'unmatched') return 'No WinGet package match was found for this app.';
  if (status === 'pending') return 'Match analysis is in progress.';
  if (confidence === null || confidence === undefined) return 'Match confidence data is not available.';

  const pct = Math.round(confidence * 100);
  if (pct >= 90) return `${pct}% confidence - strong match based on name, publisher, and version.`;
  if (pct >= 70) return `${pct}% confidence - likely match but verify the package is correct.`;
  return `${pct}% confidence - weak match. Consider linking a different package.`;
}

export function MatchStatusBadge({ status, confidence, className }: MatchStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const showConfidence = confidence !== null && confidence !== undefined && status !== 'unmatched';
  const confidenceInfo = showConfidence ? getConfidenceLabel(confidence!) : null;

  const badge = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border cursor-default',
        config.colors,
        className
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{config.label}</span>
      {showConfidence && confidenceInfo && (
        <span className={cn('font-semibold', confidenceInfo.color)}>
          {confidenceInfo.label}
        </span>
      )}
    </span>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px]">
          <p>{getConfidenceTooltip(status, confidence)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
