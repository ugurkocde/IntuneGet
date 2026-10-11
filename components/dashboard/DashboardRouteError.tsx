'use client';

import { ReactNode, useEffect } from 'react';
import { AlertTriangle, RefreshCw, LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { T } from 'gt-next';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { reportPageError } from '@/lib/logging/report-page-error';

interface DashboardRouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Page title shown in the header, matching the page's own PageHeader */
  title: ReactNode;
  /** Page description shown in the header */
  description?: ReactNode;
  /** Page icon, matching the page's own PageHeader */
  icon?: LucideIcon;
  /** Log prefix for console.error */
  logLabel: string;
}

export function DashboardRouteError({
  error,
  reset,
  title,
  description,
  icon,
  logLabel,
}: DashboardRouteErrorProps) {
  useEffect(() => {
    console.error(`${logLabel} page error:`, error);
    reportPageError('dashboard', error.digest);
  }, [error, logLabel]);

  const message = error.message || '';
  const isThrottling = message.includes('429') || message.toLowerCase().includes('throttl');
  const isTimeout = message.toLowerCase().includes('timed out') || message.toLowerCase().includes('timeout');

  return (
    <div className="space-y-8">
      <PageHeader title={title} description={description} icon={icon} />

      <div className="glass-light rounded-2xl p-10 border border-status-error/20">
        <div className="flex flex-col items-center text-center max-w-lg mx-auto">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-status-error/20 to-status-error/10 flex items-center justify-center mb-6">
            <AlertTriangle className="w-10 h-10 text-status-error" />
          </div>

          <h2 className="text-2xl font-semibold text-text-primary mb-3">
            {isThrottling
              ? <T>Microsoft Graph Is Throttling Requests</T>
              : <T>Unable to Load This Page</T>}
          </h2>
          <p className="text-text-secondary mb-8">
            {isThrottling
              ? <T>Your tenant is currently rate-limited by Microsoft Graph (429). This is common on large tenants. Please wait a minute and try again.</T>
              : isTimeout
                ? <T>The request took too long to respond. Please try again in a moment.</T>
                : <T>Something went wrong while loading this page. Please try again.</T>}
          </p>

          <div className="flex gap-3">
            <Button
              onClick={() => reset()}
              className="bg-accent-cyan hover:bg-accent-cyan-dim text-black font-medium"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              <T>Try Again</T>
            </Button>
            <Button asChild variant="outline" className="border-overlay/10 hover:bg-overlay/5">
              <Link href="/dashboard"><T>Back to Dashboard</T></Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
