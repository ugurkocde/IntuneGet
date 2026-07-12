'use client';

import { ArrowUpCircle } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function UpdatesError({
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
      title={<T>App Updates</T>}
      description={<T>Manage app updates and auto-update policies</T>}
      icon={ArrowUpCircle}
      logLabel="App Updates"
    />
  );
}
