'use client';

import { Radar } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function UnmanagedAppsError({
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
      title={<T>Unmanaged Apps</T>}
      description={<T>Unmanaged apps detected across your devices</T>}
      icon={Radar}
      logLabel="Unmanaged Apps"
    />
  );
}
