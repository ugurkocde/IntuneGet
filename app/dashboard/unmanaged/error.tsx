'use client';

import { useEffect } from 'react';
import { Radar, AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/dashboard/PageHeader';

export default function UnmanagedAppsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unmanaged Apps page error:', error);
  }, [error]);

  const message = error.message || '';
  const isThrottling = message.includes('429') || message.toLowerCase().includes('throttl');
  const isTimeout = message.toLowerCase().includes('timed out') || message.toLowerCase().includes('timeout');

  return (
    <div className="space-y-8">
      <PageHeader
        title="Unmanaged Apps"
        description="Unmanaged apps detected across your devices"
        icon={Radar}
      />

      <div className="glass-light rounded-2xl p-10 border border-status-error/20">
        <div className="flex flex-col items-center text-center max-w-lg mx-auto">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-status-error/20 to-status-error/10 flex items-center justify-center mb-6">
            <AlertTriangle className="w-10 h-10 text-status-error" />
          </div>

          <h2 className="text-2xl font-semibold text-text-primary mb-3">
            {isThrottling ? 'Microsoft Graph Is Throttling Requests' : 'Unable to Load Apps'}
          </h2>
          <p className="text-text-secondary mb-8">
            {isThrottling
              ? 'Your tenant is currently rate-limited by Microsoft Graph (429). This is common on large tenants. Please wait a minute and try again.'
              : isTimeout
                ? 'The request took too long to respond. Please try again in a moment.'
                : 'Something went wrong while loading your unmanaged apps. Please try again.'}
          </p>

          <div className="flex gap-3">
            <Button
              onClick={() => reset()}
              className="bg-accent-cyan hover:bg-accent-cyan-dim text-black font-medium"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            <Button asChild variant="outline" className="border-overlay/10 hover:bg-overlay/5">
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
