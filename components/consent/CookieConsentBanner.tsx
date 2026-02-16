'use client';

import Link from 'next/link';
import * as React from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getAnalyticsConsent,
  onConsentChange,
  setAnalyticsConsent,
} from '@/lib/consent/cookie-consent';

interface CookieConsentBannerProps {
  plausibleDomain?: string;
}

export function CookieConsentBanner({
  plausibleDomain,
}: CookieConsentBannerProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    if (!plausibleDomain) {
      return;
    }

    const current = getAnalyticsConsent();
    setIsVisible(current === 'unset');
    setIsReady(true);

    const unsubscribe = onConsentChange((status) => {
      setIsVisible(status === 'unset');
    });

    return unsubscribe;
  }, [plausibleDomain]);

  const handleAccept = () => {
    setAnalyticsConsent('granted');
    setIsVisible(false);
  };

  const handleDecline = () => {
    setAnalyticsConsent('denied');
    setIsVisible(false);
  };

  if (!plausibleDomain) return null;
  if (!isReady || !isVisible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 sm:right-4 sm:left-auto sm:w-[420px] lg:w-[480px]">
      <div className="glass-light rounded-xl border border-overlay/10 bg-bg-elevated p-4 shadow-soft-md animate-fade-up">
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-accent-cyan/10 p-2 text-accent-cyan">
              <Cookie className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">
                Help us improve the app with anonymous usage analytics
              </p>
              <p className="mt-1 text-xs text-text-muted">
                We use Plausible for privacy-friendly aggregate insights. No
                personal data, cookies, or fingerprinting.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row">
              <Button
                onClick={handleAccept}
                size="sm"
                className="w-full sm:w-auto bg-accent-cyan text-black font-medium hover:bg-accent-cyan-bright"
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                Accept analytics
              </Button>
              <Button
                onClick={handleDecline}
                size="sm"
                variant="outline"
                className="w-full sm:w-auto border-overlay/20"
              >
                Decline
              </Button>
            </div>

            <Button asChild variant="ghost" size="sm" className="w-full sm:w-auto">
              <Link href="/privacy">Learn more</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
