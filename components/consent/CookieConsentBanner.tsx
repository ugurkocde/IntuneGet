'use client';

import Link from 'next/link';
import * as React from 'react';
import { Cookie, ShieldCheck } from 'lucide-react';
import { T, useGT } from 'gt-next';
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
  const t = useGT();
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
    <div
      role="region"
      aria-label={t('Analytics consent')}
      className="fixed inset-x-4 bottom-4 z-50 sm:right-4 sm:left-auto sm:w-[420px] lg:w-[480px]"
    >
      <div className="glass-light rounded-xl border border-overlay/10 bg-bg-elevated p-3 sm:p-4 shadow-soft-md animate-fade-up">
        <div className="space-y-2.5 sm:space-y-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 hidden rounded-lg bg-accent-cyan/10 p-2 text-accent-cyan sm:block">
              <Cookie className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">
                <T id="consent.heading">Help us improve the app with anonymous usage analytics</T>
              </p>
              <p className="mt-1 hidden text-xs text-text-muted sm:block">
                <T id="consent.description">
                  We use Plausible for privacy-friendly aggregate insights. No
                  personal data, cookies, or fingerprinting.
                </T>{' '}
                <Link href="/privacy" className="underline hover:text-text-secondary">
                  <T id="consent.learn-more">Learn more</T>
                </Link>
              </p>
            </div>
          </div>

          <div className="flex flex-row items-center gap-2">
            <Button
              onClick={handleAccept}
              size="sm"
              className="flex-1 sm:flex-none bg-accent-cyan text-black font-medium hover:bg-accent-cyan-bright"
            >
              <ShieldCheck className="w-4 h-4 mr-2" />
              <T id="consent.accept">Accept analytics</T>
            </Button>
            <Button
              onClick={handleDecline}
              size="sm"
              variant="outline"
              className="flex-1 sm:flex-none border-overlay/20"
            >
              <T id="consent.decline">Decline</T>
            </Button>
            <Link
              href="/privacy"
              className="ml-auto text-xs text-text-muted underline hover:text-text-secondary sm:hidden"
            >
              <T id="consent.learn-more-mobile">Learn more</T>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
