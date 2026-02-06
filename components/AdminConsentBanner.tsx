'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, Copy, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';

const CONSENT_STORAGE_KEY = 'intuneget_consent_granted';
const CONSENT_CACHE_KEY = 'intuneget_consent_verified_at';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

interface AdminConsentBannerProps {
  onConsentGranted?: () => void;
}

type ConsentErrorType = 'missing_credentials' | 'network_error' | 'consent_not_granted' | 'insufficient_intune_permissions' | null;

interface ConsentVerificationResult {
  verified: boolean;
  tenantId: string;
  message: string;
  cachedResult?: boolean;
  error?: ConsentErrorType;
}

/**
 * Banner that shows when admin consent hasn't been granted yet.
 *
 * Admin consent is required for:
 * - The service principal to upload apps to the user's Intune tenant
 * - Only Global Admins or Privileged Role Admins can grant consent
 * - Intune Admins cannot grant consent (they can only use the app after consent)
 */
export function AdminConsentBanner({ onConsentGranted }: AdminConsentBannerProps) {
  const { user, getAccessToken, requestAdminConsent, getShareableConsentUrl } = useMicrosoftAuth();
  const [isVisible, setIsVisible] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showShareOption, setShowShareOption] = useState(false);
  const [errorType, setErrorType] = useState<ConsentErrorType>(null);

  /**
   * Verify consent via API
   */
  const verifyConsentViaApi = useCallback(async (): Promise<ConsentVerificationResult> => {
    try {
      const token = await getAccessToken();
      if (!token) return { verified: false, tenantId: '', message: 'No token', error: 'network_error' };

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { verified: false, tenantId: '', message: 'Request failed', error: 'network_error' };
      }

      const result: ConsentVerificationResult = await response.json();
      return result;
    } catch (error) {
      console.error('Error verifying consent:', error);
      return { verified: false, tenantId: '', message: 'Error', error: 'network_error' };
    }
  }, [getAccessToken]);

  /**
   * Check if we should verify consent
   */
  const shouldVerifyConsent = useCallback((): boolean => {
    // Check localStorage cache first
    const localConsent = localStorage.getItem(CONSENT_STORAGE_KEY);
    const cachedAt = localStorage.getItem(CONSENT_CACHE_KEY);

    if (localConsent === 'true' && cachedAt) {
      const cacheTime = parseInt(cachedAt, 10);
      if (Date.now() - cacheTime < CACHE_DURATION_MS) {
        // Cache is still valid
        return false;
      }
    }

    return true;
  }, []);

  useEffect(() => {
    if (!user) {
      setIsVisible(false);
      return;
    }

    // Quick check: if localStorage says we're good and cache is fresh, don't show
    if (!shouldVerifyConsent()) {
      setIsVisible(false);
      return;
    }

    // Verify via API
    const checkConsent = async () => {
      setIsVerifying(true);
      const result = await verifyConsentViaApi();
      setIsVerifying(false);

      if (result.verified) {
        // Update localStorage cache
        localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
        localStorage.setItem(CONSENT_CACHE_KEY, Date.now().toString());
        setIsVisible(false);
        setErrorType(null);
        onConsentGranted?.();
      } else {
        // Clear any stale cache
        localStorage.removeItem(CONSENT_STORAGE_KEY);
        localStorage.removeItem(CONSENT_CACHE_KEY);
        setErrorType(result.error || 'consent_not_granted');
        setIsVisible(true);
      }
    };

    checkConsent();
  }, [user, verifyConsentViaApi, shouldVerifyConsent, onConsentGranted]);

  const handleGrantConsent = () => {
    requestAdminConsent();
  };

  const handleCopyLink = async () => {
    const url = getShareableConsentUrl();
    if (url) {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDismiss = () => {
    // User chose to skip for now - hide banner but don't cache
    setIsVisible(false);
  };

  const handleAlreadyGranted = async () => {
    // User claims consent was already granted - verify via API
    setIsVerifying(true);
    const result = await verifyConsentViaApi();
    setIsVerifying(false);

    if (result.verified) {
      localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
      localStorage.setItem(CONSENT_CACHE_KEY, Date.now().toString());
      setIsVisible(false);
      setErrorType(null);
      onConsentGranted?.();
    } else {
      // Set the error type to show appropriate message
      setErrorType(result.error || 'consent_not_granted');
    }
  };

  // Show loading state while verifying
  if (isVerifying && !isVisible) {
    return (
      <div className="bg-bg-elevated/50 border border-black/10 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-accent-cyan animate-spin" />
          <span className="text-text-secondary">Verifying organization setup...</span>
        </div>
      </div>
    );
  }

  if (!isVisible) return null;

  // Special UI for insufficient Intune permissions (existing users who need to re-consent)
  if (errorType === 'insufficient_intune_permissions') {
    return (
      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-500/20 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium text-text-primary mb-1">
              Intune Permissions Missing
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              Admin consent was granted, but required Intune permissions are missing.
              The app needs <code className="text-amber-600 text-xs">DeviceManagementApps.ReadWrite.All</code> and
              <code className="text-amber-600 text-xs ml-1">DeviceManagementManagedDevices.Read.All</code>.
              This can happen if permissions were updated after initial consent.
            </p>
            <p className="text-sm text-text-secondary mb-4">
              <strong className="text-amber-600">Your packaging jobs may be failing because of this.</strong> A Global Administrator needs to re-grant admin consent.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleGrantConsent}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                <Shield className="w-4 h-4 mr-2" />
                Re-grant Admin Consent
              </Button>
              <Button
                onClick={handleAlreadyGranted}
                size="sm"
                variant="ghost"
                className="text-text-secondary hover:text-text-primary"
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Check Again'
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-6">
      <div className="flex items-start gap-3">
        <div className="p-2 bg-amber-500/20 rounded-lg">
          <Shield className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1">
          <h3 className="font-medium text-text-primary mb-1">
            Organization Setup Required
          </h3>
          <p className="text-sm text-text-secondary mb-4">
            To deploy apps to your Intune tenant, a <strong className="text-amber-600">Global Administrator</strong> needs
            to grant permission for IntuneGet to access your organization.
          </p>

          {!showShareOption ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleGrantConsent}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                <Shield className="w-4 h-4 mr-2" />
                Grant Admin Consent
              </Button>
              <Button
                onClick={() => setShowShareOption(true)}
                size="sm"
                variant="outline"
                className="border-black/10 text-text-primary hover:bg-black/5"
              >
                I'm not a Global Admin
              </Button>
              <Button
                onClick={handleAlreadyGranted}
                size="sm"
                variant="ghost"
                className="text-text-secondary hover:text-text-primary"
              >
                Already granted
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 p-3 bg-bg-elevated/50 rounded-lg">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-text-primary">
                  <p className="mb-2">
                    <strong>Intune Administrators</strong> cannot grant admin consent.
                    Please share this link with your Global Administrator:
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <code className="flex-1 bg-bg-surface px-3 py-2 rounded text-xs text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                      {getShareableConsentUrl() || 'Loading...'}
                    </code>
                    <Button
                      onClick={handleCopyLink}
                      size="sm"
                      variant="outline"
                      className="border-black/10 flex-shrink-0"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => setShowShareOption(false)}
                  size="sm"
                  variant="ghost"
                  className="text-text-secondary hover:text-text-primary"
                >
                  Back
                </Button>
                <Button
                  onClick={handleDismiss}
                  size="sm"
                  variant="ghost"
                  className="text-text-secondary hover:text-text-primary"
                >
                  I'll do this later
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-text-muted mt-4">
            This is a one-time setup. After consent is granted, any user with Intune permissions can use IntuneGet.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Mark consent as granted (called from consent callback page)
 * This updates the localStorage cache with current timestamp
 */
export function markConsentGranted() {
  if (typeof window !== 'undefined') {
    localStorage.setItem(CONSENT_STORAGE_KEY, 'true');
    localStorage.setItem(CONSENT_CACHE_KEY, Date.now().toString());
  }
}

/**
 * Check if consent has been granted (checks localStorage cache)
 * Note: This is a quick check - actual verification should use the API
 */
export function isConsentGranted(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(CONSENT_STORAGE_KEY) === 'true';
}

/**
 * Clear consent status (for testing or re-authorization)
 */
export function clearConsentStatus() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    localStorage.removeItem(CONSENT_CACHE_KEY);
  }
}

/**
 * Verify consent via API
 * This is the authoritative check - uses client credentials to verify
 */
export async function verifyConsentApi(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/verify-consent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return false;

    const result = await response.json();
    return result.verified === true;
  } catch {
    return false;
  }
}
