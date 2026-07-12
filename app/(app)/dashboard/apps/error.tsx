'use client';

import { Package } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function AppsError({
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
      title={<T>App Catalog</T>}
      description={<T>Browse and deploy applications to Intune</T>}
      icon={Package}
      logLabel="App Catalog"
    />
  );
}
