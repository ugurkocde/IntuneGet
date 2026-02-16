const COOKIE_CONSENT_EVENT = 'intuneget:cookie-consent-changed';
export const COOKIE_CONSENT_KEY = 'intuneget_cookie_consent';
export const COOKIE_CONSENT_UPDATED_AT_KEY = 'intuneget_cookie_consent_updated_at';

export type AnalyticsConsent = 'granted' | 'denied' | 'unset';

export function getAnalyticsConsent(): AnalyticsConsent {
  if (typeof window === 'undefined') return 'unset';

  try {
    const storedConsent = window.localStorage.getItem(COOKIE_CONSENT_KEY);

    if (storedConsent === 'granted' || storedConsent === 'denied') {
      return storedConsent;
    }
  } catch (error) {
    console.warn('Failed to read cookie consent state:', error);
  }

  return 'unset';
}

export function setAnalyticsConsent(
  consent: Exclude<AnalyticsConsent, 'unset'>,
): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(COOKIE_CONSENT_KEY, consent);
    window.localStorage.setItem(
      COOKIE_CONSENT_UPDATED_AT_KEY,
      Date.now().toString(),
    );
  } catch (error) {
    console.error('Failed to persist cookie consent:', error);
    return;
  }

  dispatchConsentChanged(consent);
}

export function clearAnalyticsConsent(): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(COOKIE_CONSENT_KEY);
    window.localStorage.removeItem(COOKIE_CONSENT_UPDATED_AT_KEY);
  } catch (error) {
    console.error('Failed to clear cookie consent:', error);
  }

  dispatchConsentChanged('unset');
}

type ConsentChangeListener = (consent: AnalyticsConsent) => void;

export function onConsentChange(
  listener: ConsentChangeListener,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ consent: AnalyticsConsent }>;
    const consent = customEvent?.detail?.consent;

    if (consent === 'granted' || consent === 'denied' || consent === 'unset') {
      listener(consent);
      return;
    }

    listener(getAnalyticsConsent());
  };

  window.addEventListener(COOKIE_CONSENT_EVENT, handler);
  return () => window.removeEventListener(COOKIE_CONSENT_EVENT, handler);
}

function dispatchConsentChanged(consent: AnalyticsConsent): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(COOKIE_CONSENT_EVENT, {
      detail: {
        consent,
      },
    }),
  );
}

