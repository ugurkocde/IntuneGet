'use client';

import { BarChart3 } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <DashboardRouteError
      error={error}
      reset={reset}
      title={<T>Reports & Analytics</T>}
      description={<T>Track your deployment performance and trends</T>}
      icon={BarChart3}
      logLabel="Reports"
    />
  );
}
