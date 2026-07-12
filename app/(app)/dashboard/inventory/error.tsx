'use client';

import { Server } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function InventoryError({
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
      title={<T>Inventory</T>}
      description={<T>Win32 applications deployed in your Intune tenant</T>}
      icon={Server}
      logLabel="Inventory"
    />
  );
}
