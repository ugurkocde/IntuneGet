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
import { T } from "gt-next";
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
          <div className="inline-flex items-center justify-center w-20 h-20 bg-overlay/[0.06] rounded-2xl">
            <Loader2 className="w-10 h-10 text-accent-cyan animate-spin" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-text-primary mb-4">
          <T>Checking Organization Setup</T>
        </h1>
        <p className="text-text-muted">
          <T>Verifying admin consent for your tenant...</T>
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
        <h1 className="text-2xl font-bold text-text-primary mb-4">
          <T>Admin Consent Verified</T>
        </h1>
        <p className="text-text-muted">
          <T>Your organization is set up. Continuing to next step...</T>
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
        <h1 className="text-2xl font-bold text-text-primary mb-4">
          <T>Configuration Error</T>
        </h1>
        <p className="text-text-muted mb-6">
          <T>The server is not properly configured to verify admin consent.
          Please contact your administrator.</T>
        </p>
        <div className="bg-bg-elevated border border-overlay/10 rounded-xl p-4 mb-6 shadow-soft">
          <p className="text-sm text-text-muted">
            <T>Technical details: AZURE_AD_CLIENT_SECRET environment variable is missing.</T>
          </p>
        </div>
        <Button
          onClick={onBack}
          variant="ghost"
          className="text-text-muted hover:text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          <T>Back to welcome</T>
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
        <h1 className="text-2xl font-bold text-text-primary mb-4">
          <T>Connection Error</T>
        </h1>
        <p className="text-text-muted mb-6">
          <T>Unable to verify organization setup. Please check your internet
          connection and try again.</T>
        </p>
        <div className="flex items-center justify-center gap-4">
          <Button
            onClick={onBack}
            variant="ghost"
            className="text-text-muted hover:text-text-secondary"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            <T>Back</T>
          </Button>
          <Button
            onClick={handleVerify}
            disabled={isVerifying}
            className="bg-accent-cyan hover:bg-accent-cyan-dim text-white"
          >
            {isVerifying ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                <T>Retrying...</T>
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                <T>Try Again</T>
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
        <h1 className="text-2xl font-bold text-text-primary mb-4">
          <T>Intune Permissions Missing</T>
        </h1>
        <p className="text-text-muted mb-6">
          <T>Admin consent was granted, but required Intune permissions are missing.
          The app needs <code className="text-amber-600 bg-amber-500/10 px-1 rounded">DeviceManagementApps.ReadWrite.All</code>,
          <code className="text-amber-600 bg-amber-500/10 px-1 rounded ml-1">DeviceManagementManagedDevices.Read.All</code>, and
          <code className="text-amber-600 bg-amber-500/10 px-1 rounded ml-1">DeviceManagementServiceConfig.ReadWrite.All</code> (for ESP profiles).
          This can happen if permissions were updated after initial consent.</T>
        </p>
        <div className="bg-bg-elevated border border-overlay/10 rounded-xl p-6 mb-6 shadow-soft">
          <p className="text-sm text-text-secondary mb-4">
            <T>A <strong className="text-amber-600">Global Administrator</strong> needs to re-grant admin consent
            to include the updated permissions.</T>
          </p>
          <Button
            onClick={handleGrantConsent}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            <Shield className="w-4 h-4 mr-2" />
            <T>Re-grant Admin Consent</T>
          </Button>
        </div>
        <Button
          onClick={handleVerify}
          disabled={isVerifying}
          variant="ghost"
          className="text-text-muted hover:text-text-secondary"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              <T>Verifying...</T>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              <T>Check Again</T>
            </>
          )}
        </Button>
        <div className="mt-8">
          <Button
            onClick={onBack}
            variant="ghost"
            className="text-text-muted hover:text-text-secondary"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            <T>Back to welcome</T>
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
      <h1 className="text-2xl font-bold text-text-primary mb-4">
        <T>Admin Consent Required</T>
      </h1>

      <p className="text-text-muted mb-6">
        <T>To deploy apps to your Intune tenant, a{' '}
        <strong className="text-amber-600">Global Administrator</strong> or{' '}
        <strong className="text-amber-600">Privileged Role Administrator</strong>{' '}
        must grant permission for IntuneGet to access your organization.</T>
      </p>

      {/* Role selection question */}
      <div className="bg-bg-elevated border border-overlay/10 rounded-xl p-6 mb-6 shadow-soft">
        <p className="text-text-primary font-medium mb-4">
          <T>Are you a Global Administrator?</T>
        </p>

        {!showShareOption ? (
          <div className="space-y-3">
            {/* Primary option - for non-admins (most common case) */}
            <Button
              onClick={() => setShowShareOption(true)}
              size="lg"
              className="w-full bg-accent-cyan hover:bg-accent-cyan-dim text-white font-medium"
            >
              <T>No, I need to request access from my admin</T>
            </Button>

            {/* Secondary option - for actual admins */}
            <Button
              onClick={handleGrantConsent}
              size="lg"
              variant="outline"
              className="w-full border-overlay/15 text-text-secondary hover:bg-overlay/[0.04]"
            >
              <Shield className="w-4 h-4 mr-2" />
              <T>Yes, I am a Global Administrator</T>
            </Button>

            {/* Warning about admin requirement */}
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-xs text-amber-700">
                <T>Only Global Administrators or Privileged Role Administrators can grant consent.
                Intune Administrators and other roles cannot grant organization-wide permissions.</T>
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Share link option */}
            <div className="text-left">
              <p className="text-sm text-text-secondary mb-4">
                <T>Share this link with your Global Administrator. They need to click it and approve the permissions:</T>
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-4">
                <code className="flex-1 bg-overlay/[0.06] px-3 py-2 rounded-lg text-xs text-text-secondary overflow-hidden text-ellipsis whitespace-nowrap">
                  {shareableUrl}
                </code>
                <Button
                  onClick={handleCopyLink}
                  size="sm"
                  variant="outline"
                  className="border-overlay/15 flex-shrink-0"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>

              <div className="bg-overlay/[0.06] rounded-lg p-3 mb-4">
                <p className="text-xs text-text-secondary mb-2">
                  <strong className="text-text-secondary"><T>What to tell your admin:</T></strong>
                </p>
                <p className="text-xs text-text-muted">
                  <T>"I need you to approve IntuneGet for our organization. Please click this link and sign in with your Global Admin account to grant the required permissions."</T>
                </p>
              </div>

              <p className="text-xs text-text-muted">
                <T>After your admin grants consent, click the button below to verify.</T>
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-4">
              <Button
                onClick={() => setShowShareOption(false)}
                variant="ghost"
                className="text-text-muted hover:text-text-secondary"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                <T>Back</T>
              </Button>
              <Button
                onClick={handleVerify}
                disabled={isVerifying}
                className="bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    <T>Verifying...</T>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    <T>My admin approved it - Verify</T>
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
          className="text-text-muted hover:text-text-secondary"
        >
          {isVerifying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              <T>Verifying...</T>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              <T>Already granted? Click to verify</T>
            </>
          )}
        </Button>
      )}

      {/* Back button */}
      <div className="mt-8">
        <Button
          onClick={onBack}
          variant="ghost"
          className="text-text-muted hover:text-text-secondary"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          <T>Back to welcome</T>
        </Button>
      </div>
    </div>
  );
}
