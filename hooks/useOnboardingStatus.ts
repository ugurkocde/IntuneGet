'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import {
  isOnboardingCacheValid,
  markOnboardingComplete,
} from '@/lib/onboarding-utils';

interface OnboardingStatus {
  isOnboardingComplete: boolean;
  isChecking: boolean;
  tenantId: string | null;
  error: string | null;
  verifyConsent: () => Promise<boolean>;
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

  /**
   * Verify consent via API (authoritative check)
   */
  const verifyConsent = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Unable to get access token');
        return false;
      }

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return false;
      }

      const result = await response.json();
      return result.verified === true;
    } catch (err) {
      console.error('Error verifying consent:', err);
      return false;
    }
  }, [getAccessToken]);

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

      // Quick check: is localStorage cache valid?
      if (isOnboardingCacheValid()) {
        setIsOnboardingComplete(true);
        setIsChecking(false);
        return;
      }

      // Authoritative check via API
      const verified = await verifyConsent();

      if (verified) {
        // Mark onboarding as complete in cache
        markOnboardingComplete();
        setIsOnboardingComplete(true);
      } else {
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
    verifyConsent,
  };
}
