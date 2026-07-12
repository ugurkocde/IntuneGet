'use client';

import { Building2 } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function MspError({
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
      title={<T>MSP Dashboard</T>}
      description={<T>Manage deployments across your client tenants</T>}
      icon={Building2}
      logLabel="MSP"
    />
  );
}
