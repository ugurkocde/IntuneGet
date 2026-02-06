'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { getShareableConsentUrl } from '@/lib/onboarding-utils';

interface ConsentStepProps {
  onNext: () => void;
  onBack: () => void;
}

type ConsentStatus = 'checking' | 'not_granted' | 'granted' | 'network_error' | 'config_error' | 'insufficient_permissions';
type ConsentErrorType = 'missing_credentials' | 'network_error' | 'consent_not_granted' | 'insufficient_intune_permissions' | null;

interface ConsentVerifyResult {
  verified: boolean;
  error?: ConsentErrorType;
}

export function ConsentStep({ onNext, onBack }: ConsentStepProps) {
  const { user, getAccessToken, requestAdminConsent } = useMicrosoftAuth();
  const [status, setStatus] = useState<ConsentStatus>('checking');
  const [showShareOption, setShowShareOption] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const shareableUrl = getShareableConsentUrl(user?.tenantId);

  /**
   * Verify consent via API - returns structured result with error type
   */
  const verifyConsent = useCallback(async (): Promise<ConsentVerifyResult> => {
    try {
      const token = await getAccessToken();
      if (!token) {
        return { verified: false, error: 'network_error' };
      }

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // Handle network-level errors
      if (!response.ok && response.status >= 500) {
        return { verified: false, error: 'network_error' };
      }

      const result = await response.json();

      if (result.verified === true) {
        return { verified: true };
      }

      // Return the specific error type from API
      return {
        verified: false,
        error: result.error as ConsentErrorType || 'consent_not_granted',
      };
    } catch (error) {
      console.error('Error verifying consent:', error);
      return { verified: false, error: 'network_error' };
    }
  }, [getAccessToken]);

  /**
   * Check consent on mount
   */
  useEffect(() => {
    const checkConsent = async () => {
      setStatus('checking');
      const result = await verifyConsent();
      if (result.verified) {
        setStatus('granted');
        // Auto-advance after short delay
        setTimeout(() => onNext(), 1500);
      } else if (result.error === 'missing_credentials') {
        setStatus('config_error');
      } else if (result.error === 'network_error') {
        setStatus('network_error');
      } else if (result.error === 'insufficient_intune_permissions') {
        setStatus('insufficient_permissions');
      } else {
        setStatus('not_granted');
      }
    };

    checkConsent();
  }, [verifyConsent, onNext]);

  /**
   * Handle grant consent button click
   */
  const handleGrantConsent = () => {
    requestAdminConsent();
  };

  /**
   * Handle copy link button click
   */
  const handleCopyLink = async () => {
    if (shareableUrl) {
      await navigator.clipboard.writeText(shareableUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  /**
   * Handle manual verify button click
   */
  const handleVerify = async () => {
    setIsVerifying(true);
    const result = await verifyConsent();
    setIsVerifying(false);

    if (result.verified) {
      setStatus('granted');
      setTimeout(() => onNext(), 1500);
    } else if (result.error === 'missing_credentials') {
      setStatus('config_error');
    } else if (result.error === 'network_error') {
      setStatus('network_error');
    } else if (result.error === 'insufficient_intune_permissions') {
      setStatus('insufficient_permissions');
    } else {
      setStatus('not_granted');
    }
  };

  // Loading/checking state
  if (status === 'checking') {
    return (
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-stone-100 rounded-2xl">
            <Loader2 className="w-10 h-10 text-accent-cyan animate-spin" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-stone-900 mb-4">
          Checking Organization Setup
        </h1>
        <p className="text-stone-500">
          Verifying admin consent for your tenant...
        </p>
      </div>
    );
  }

  // Already granted state
  if (status === 'granted') {
    return (
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-emerald-500/10 rounded-2xl">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-stone-900 mb-4">
          Admin Consent Verified
        </h1>
        <p className="text-stone-500">
          Your organization is set up. Continuing to next step...
        </p>
      </div>
    );
  }

  // Server configuration error state
  if (status === 'config_error') {
    return (
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-red-500/10 rounded-2xl">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-stone-900 mb-4">
          Configuration Error
        </h1>
        <p className="text-stone-500 mb-6">
          The server is not properly configured to verify admin consent.
          Please contact your administrator.
        </p>
        <div className="bg-white border border-stone-200 rounded-xl p-4 mb-6 shadow-soft">
          <p className="text-sm text-stone-500">
            Technical details: AZURE_AD_CLIENT_SECRET environment variable is missing.
          </p>
        </div>
        <Button
          onClick={onBack}
          variant="ghost"
          className="text-stone-500 hover:text-stone-700"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to welcome
        </Button>
      </div>
    );
  }

  // Network error state
  if (status === 'network_error') {
    return (
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-500/10 rounded-2xl">
            <AlertTriangle className="w-10 h-10 text-amber-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-stone-900 mb-4">
          Connection Error
        </h1>
        <p className="text-stone-500 mb-6">
          Unable to verify organization setup. Please check your internet
          connection and try again.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button
            onClick={onBack}
            variant="ghost"
            className="text-stone-500 hover:text-stone-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button
            onClick={handleVerify}
            disabled={isVerifying}
            className="bg-accent-cyan hover:bg-accent-cyan-dim text-white"
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  // Insufficient Intune permissions state
  if (status === 'insufficient_permissions') {
    return (
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-500/10 rounded-2xl">
            <AlertTriangle className="w-10 h-10 text-amber-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-stone-900 mb-4">
          Intune Permissions Missing
        </h1>
        <p className="text-stone-500 mb-6">
          Admin consent was granted, but required Intune permissions are missing.
          The app needs <code className="text-amber-600 bg-amber-50 px-1 rounded">DeviceManagementApps.ReadWrite.All</code> and
          <code className="text-amber-600 bg-amber-50 px-1 rounded ml-1">DeviceManagementManagedDevices.Read.All</code>.
          This can happen if permissions were updated after initial consent.
        </p>
        <div className="bg-white border border-stone-200 rounded-xl p-6 mb-6 shadow-soft">
          <p className="text-sm text-stone-600 mb-4">
            A <strong className="text-amber-600">Global Administrator</strong> needs to re-grant admin consent
            to include the updated permissions.
          </p>
          <Button
            onClick={handleGrantConsent}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            <Shield className="w-4 h-4 mr-2" />
            Re-grant Admin Consent
          </Button>
        </div>
        <Button
          onClick={handleVerify}
          disabled={isVerifying}
          variant="ghost"
          className="text-stone-500 hover:text-stone-700"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Check Again
            </>
          )}
        </Button>
        <div className="mt-8">
          <Button
            onClick={onBack}
            variant="ghost"
            className="text-stone-400 hover:text-stone-600"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to welcome
          </Button>
        </div>
      </div>
    );
  }

  // Not granted state - show options
  return (
    <div className="text-center max-w-2xl mx-auto">
      {/* Icon */}
      <div className="mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-amber-500/10 rounded-2xl">
          <Shield className="w-10 h-10 text-amber-500" />
        </div>
      </div>

      {/* Heading */}
      <h1 className="text-2xl font-bold text-stone-900 mb-4">
        Admin Consent Required
      </h1>

      <p className="text-stone-500 mb-6">
        To deploy apps to your Intune tenant, a{' '}
        <strong className="text-amber-600">Global Administrator</strong> or{' '}
        <strong className="text-amber-600">Privileged Role Administrator</strong>{' '}
        must grant permission for IntuneGet to access your organization.
      </p>

      {/* Role selection question */}
      <div className="bg-white border border-stone-200 rounded-xl p-6 mb-6 shadow-soft">
        <p className="text-stone-900 font-medium mb-4">
          Are you a Global Administrator?
        </p>

        {!showShareOption ? (
          <div className="space-y-3">
            {/* Primary option - for non-admins (most common case) */}
            <Button
              onClick={() => setShowShareOption(true)}
              size="lg"
              className="w-full bg-accent-cyan hover:bg-accent-cyan-dim text-white font-medium"
            >
              No, I need to request access from my admin
            </Button>

            {/* Secondary option - for actual admins */}
            <Button
              onClick={handleGrantConsent}
              size="lg"
              variant="outline"
              className="w-full border-stone-300 text-stone-700 hover:bg-stone-50"
            >
              <Shield className="w-4 h-4 mr-2" />
              Yes, I am a Global Administrator
            </Button>

            {/* Warning about admin requirement */}
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700">
                Only Global Administrators or Privileged Role Administrators can grant consent.
                Intune Administrators and other roles cannot grant organization-wide permissions.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Share link option */}
            <div className="text-left">
              <p className="text-sm text-stone-600 mb-4">
                Share this link with your Global Administrator. They need to click it and approve the permissions:
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
                <code className="flex-1 bg-stone-100 px-3 py-2 rounded-lg text-xs text-stone-600 overflow-hidden text-ellipsis whitespace-nowrap">
                  {shareableUrl}
                </code>
                <Button
                  onClick={handleCopyLink}
                  size="sm"
                  variant="outline"
                  className="border-stone-300 flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>

              <div className="bg-stone-100 rounded-lg p-3 mb-4">
                <p className="text-xs text-stone-600 mb-2">
                  <strong className="text-stone-700">What to tell your admin:</strong>
                </p>
                <p className="text-xs text-stone-500">
                  "I need you to approve IntuneGet for our organization. Please click this link and sign in with your Global Admin account to grant the required permissions."
                </p>
              </div>

              <p className="text-xs text-stone-500">
                After your admin grants consent, click the button below to verify.
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-4">
              <Button
                onClick={() => setShowShareOption(false)}
                variant="ghost"
                className="text-stone-500 hover:text-stone-700"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleVerify}
                disabled={isVerifying}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    My admin approved it - Verify
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Already granted option - outside the card */}
      {!showShareOption && (
        <Button
          onClick={handleVerify}
          disabled={isVerifying}
          variant="ghost"
          className="text-stone-500 hover:text-stone-700"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Already granted? Click to verify
            </>
          )}
        </Button>
      )}

      {/* Back button */}
      <div className="mt-8">
        <Button
          onClick={onBack}
          variant="ghost"
          className="text-stone-400 hover:text-stone-600"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to welcome
        </Button>
      </div>
    </div>
  );
}
