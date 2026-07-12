'use client';

import { Lightbulb } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function AppRequestsError({
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
      title={<T>App Requests</T>}
      description={<T>Request WinGet packages and vote on requests from other users</T>}
      icon={Lightbulb}
      logLabel="App Requests"
    />
  );
}
