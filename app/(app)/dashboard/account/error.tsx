'use client';

import { User } from 'lucide-react';
import { T } from 'gt-next';
import { DashboardRouteError } from '@/components/dashboard/DashboardRouteError';

export default function AccountError({
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
      title={<T>Account</T>}
      description={<T>Your profile, usage statistics, and session details</T>}
      icon={User}
      logLabel="Account"
    />
  );
}
