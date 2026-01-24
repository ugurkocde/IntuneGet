/**
 * Onboarding utility functions
 * Handles localStorage caching for onboarding step persistence
 */

// Storage keys
export const ONBOARDING_STEP_KEY = 'intuneget_onboarding_step';
export const ONBOARDING_COMPLETE_KEY = 'intuneget_onboarding_complete';
export const ONBOARDING_CACHE_KEY = 'intuneget_onboarding_verified_at';
export const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Onboarding steps
export type OnboardingStep = 1 | 2 | 3;

export interface OnboardingState {
  currentStep: OnboardingStep;
  isComplete: boolean;
}

/**
 * Get the current onboarding step from localStorage
 */
export function getOnboardingStep(): OnboardingStep {
  if (typeof window === 'undefined') return 1;

  const saved = localStorage.getItem(ONBOARDING_STEP_KEY);
  if (saved) {
    const step = parseInt(saved, 10);
    if (step >= 1 && step <= 3) {
      return step as OnboardingStep;
    }
  }
  return 1;
}

/**
 * Save the current onboarding step to localStorage
 */
export function setOnboardingStep(step: OnboardingStep): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ONBOARDING_STEP_KEY, step.toString());
}

/**
 * Check if onboarding is complete (cached check)
 */
export function isOnboardingCacheValid(): boolean {
  if (typeof window === 'undefined') return false;

  const isComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
  if (!isComplete) return false;

  const cachedAt = localStorage.getItem(ONBOARDING_CACHE_KEY);
  if (!cachedAt) return false;

  const cacheTime = parseInt(cachedAt, 10);
  const now = Date.now();

  return now - cacheTime < CACHE_DURATION_MS;
}

/**
 * Mark onboarding as complete
 */
export function markOnboardingComplete(): void {
  if (typeof window === 'undefined') return;

  localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  localStorage.setItem(ONBOARDING_CACHE_KEY, Date.now().toString());
  // Clear step tracking since complete
  localStorage.removeItem(ONBOARDING_STEP_KEY);
}

/**
 * Clear all onboarding state (for testing/reset)
 */
export function clearOnboardingState(): void {
  if (typeof window === 'undefined') return;

  localStorage.removeItem(ONBOARDING_STEP_KEY);
  localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  localStorage.removeItem(ONBOARDING_CACHE_KEY);
}

/**
 * Get shareable admin consent URL for non-admin users
 */
export function getShareableConsentUrl(tenantId?: string): string {
  const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID || '';
  const redirectUri = typeof window !== 'undefined'
    ? `${window.location.origin}/auth/consent-callback`
    : '';
  const tenant = tenantId || 'organizations';

  return `https://login.microsoftonline.com/${tenant}/adminconsent?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}
