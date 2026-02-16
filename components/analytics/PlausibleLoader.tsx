'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { type AnalyticsConsent, getAnalyticsConsent, onConsentChange } from '@/lib/consent/cookie-consent';

interface PlausibleLoaderProps {
  domain?: string;
}

export function PlausibleLoader({ domain }: PlausibleLoaderProps) {
  const [consent, setConsent] = useState<AnalyticsConsent>('unset');

  useEffect(() => {
    if (!domain) {
      setConsent('unset');
      return;
    }

    const current = getAnalyticsConsent();
    setConsent(current);

    const unsubscribe = onConsentChange((nextConsent) => {
      setConsent(nextConsent);
    });

    return unsubscribe;
  }, [domain]);

  if (!domain || consent !== 'granted') {
    return null;
  }

  return (
    <Script
      key={`plausible-${domain}`}
      defer
      data-domain={domain}
      src="https://plausible.io/js/script.js"
      strategy="afterInteractive"
    />
  );
}

