'use client';

import { Settings } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function SettingsError({
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
      title={<T>Settings</T>}
      description={<T>Manage your account, permissions, and preferences</T>}
      icon={Settings}
      logLabel="Settings"
    />
  );
}
