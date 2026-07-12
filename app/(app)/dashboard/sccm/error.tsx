'use client';

import { FolderSync } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function SccmError({
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
      title={<T>SCCM Migration</T>}
      description={<T>Migrate applications from SCCM to Intune</T>}
      icon={FolderSync}
      logLabel="SCCM Migration"
    />
  );
}
