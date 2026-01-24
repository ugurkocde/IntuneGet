'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import {
  isOnboardingCacheValid,
  markOnboardingComplete,
  clearOnboardingCache,
} from '@/lib/onboarding-utils';

export type OnboardingErrorType = 'network_error' | 'consent_not_granted' | 'missing_credentials' | null;

interface ConsentVerifyResult {
  verified: boolean;
  error?: OnboardingErrorType;
}

interface OnboardingStatus {
  isOnboardingComplete: boolean;
  isChecking: boolean;
  tenantId: string | null;
  error: string | null;
  errorType: OnboardingErrorType;
  verifyConsent: () => Promise<ConsentVerifyResult>;
  retryVerification: () => Promise<void>;
}

/**
 * Hook to check and manage tenant onboarding status.
 * Uses localStorage cache (24h) for quick checks, with API verification
 * for authoritative status.
 *
 * Onboarding is complete when admin consent is verified for the tenant.
 */
export function useOnboardingStatus(): OnboardingStatus {
  const { user, getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const [isOnboardingComplete, setIsOnboardingComplete] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<OnboardingErrorType>(null);

  /**
   * Verify consent via API (authoritative check)
   * Returns structured result with error type for proper handling
   */
  const verifyConsent = useCallback(async (): Promise<ConsentVerifyResult> => {
    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Unable to get access token');
        setErrorType('network_error');
        return { verified: false, error: 'network_error' };
      }

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // Network-level error
      if (!response.ok && response.status >= 500) {
        setError('Unable to verify consent. Please try again.');
        setErrorType('network_error');
        return { verified: false, error: 'network_error' };
      }

      const result = await response.json();

      if (result.verified === true) {
        setError(null);
        setErrorType(null);
        return { verified: true };
      }

      // Return the specific error type from the API
      const apiErrorType = result.error as OnboardingErrorType || 'consent_not_granted';
      setError(result.message || 'Consent not granted');
      setErrorType(apiErrorType);
      return { verified: false, error: apiErrorType };
    } catch (err) {
      console.error('Error verifying consent:', err);
      setError('Network error. Please check your connection.');
      setErrorType('network_error');
      return { verified: false, error: 'network_error' };
    }
  }, [getAccessToken]);

  /**
   * Retry verification (used by dashboard retry banner)
   */
  const retryVerification = useCallback(async (): Promise<void> => {
    setIsChecking(true);
    setError(null);
    setErrorType(null);

    const result = await verifyConsent();

    if (result.verified) {
      markOnboardingComplete();
      setIsOnboardingComplete(true);
    } else {
      // On consent revocation, clear the cache
      if (result.error === 'consent_not_granted') {
        clearOnboardingCache();
      }
      setIsOnboardingComplete(false);
    }

    setIsChecking(false);
  }, [verifyConsent]);

  /**
   * Check onboarding status on mount
   */
  useEffect(() => {
    // Wait for auth to be determined
    if (!isAuthenticated) {
      setIsChecking(false);
      return;
    }

    const checkOnboarding = async () => {
      setIsChecking(true);
      setError(null);
      setErrorType(null);

      // Quick check: is localStorage cache valid?
      if (isOnboardingCacheValid()) {
        setIsOnboardingComplete(true);
        setIsChecking(false);
        return;
      }

      // Authoritative check via API
      const result = await verifyConsent();

      if (result.verified) {
        // Mark onboarding as complete in cache
        markOnboardingComplete();
        setIsOnboardingComplete(true);
      } else {
        // On consent revocation, clear the cache
        if (result.error === 'consent_not_granted') {
          clearOnboardingCache();
        }
        setIsOnboardingComplete(false);
      }

      setIsChecking(false);
    };

    checkOnboarding();
  }, [isAuthenticated, verifyConsent]);

  return {
    isOnboardingComplete,
    isChecking,
    tenantId: user?.tenantId || null,
    error,
    errorType,
    verifyConsent,
    retryVerification,
  };
}
