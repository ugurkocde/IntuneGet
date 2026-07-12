'use client';

import { Rocket } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function UploadsError({
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
      title={<T>Uploads</T>}
      description={<T>Monitor your package deployments to Intune</T>}
      icon={Rocket}
      logLabel="Uploads"
    />
  );
}
