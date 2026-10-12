'use client';

import Link from 'next/link';
import { Rocket } from 'lucide-react';
import { useDashboardStats } from '@/hooks/useAnalytics';

export function DeploymentStatusIndicator() {
  const { data: stats } = useDashboardStats();
  const pendingCount = stats?.pending ?? 0;

  if (pendingCount === 0) return null;

  return (
    <Link
      href="/dashboard/uploads?status=pending"
      className="relative flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-overlay/5 transition-all sm:w-auto sm:px-2.5"
      title={`${pendingCount} active deployment${pendingCount !== 1 ? 's' : ''}`}
      aria-label={`${pendingCount} active deployment${pendingCount !== 1 ? 's' : ''}, view pending uploads`}
    >
      <Rocket className="w-4 h-4" />
      <span className="sr-only text-xs font-medium tabular-nums sm:not-sr-only">{pendingCount}</span>
      <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent-cyan animate-pulse" />
    </Link>
  );
}
