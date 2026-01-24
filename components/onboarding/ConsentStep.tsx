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

type ConsentStatus = 'checking' | 'not_granted' | 'granted' | 'error';

export function ConsentStep({ onNext, onBack }: ConsentStepProps) {
  const { user, getAccessToken, requestAdminConsent } = useMicrosoftAuth();
  const [status, setStatus] = useState<ConsentStatus>('checking');
  const [showShareOption, setShowShareOption] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const shareableUrl = getShareableConsentUrl(user?.tenantId);

  /**
   * Verify consent via API
   */
  const verifyConsent = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getAccessToken();
      if (!token) return false;

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return false;

      const result = await response.json();
      return result.verified === true;
    } catch (error) {
      console.error('Error verifying consent:', error);
      return false;
    }
  }, [getAccessToken]);

  /**
   * Check consent on mount
   */
  useEffect(() => {
    const checkConsent = async () => {
      setStatus('checking');
      const verified = await verifyConsent();
      if (verified) {
        setStatus('granted');
        // Auto-advance after short delay
        setTimeout(() => onNext(), 1500);
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
    const verified = await verifyConsent();
    setIsVerifying(false);

    if (verified) {
      setStatus('granted');
      setTimeout(() => onNext(), 1500);
    } else {
      setStatus('not_granted');
    }
  };

  // Loading/checking state
  if (status === 'checking') {
    return (
      <div className="text-center max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-slate-800 rounded-2xl">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-4">
          Checking Organization Setup
        </h1>
        <p className="text-slate-400">
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
          <div className="inline-flex items-center justify-center w-20 h-20 bg-green-500/10 rounded-2xl">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white mb-4">
          Admin Consent Verified
        </h1>
        <p className="text-slate-400">
          Your organization is set up. Continuing to next step...
        </p>
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
      <h1 className="text-2xl font-bold text-white mb-4">
        Admin Consent Required
      </h1>

      <p className="text-slate-400 mb-8">
        To deploy apps to your Intune tenant, a{' '}
        <strong className="text-amber-400">Global Administrator</strong> needs
        to grant permission for IntuneGet to access your organization.
      </p>

      {/* Content based on showShareOption */}
      {!showShareOption ? (
        <>
          {/* Action buttons */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 mb-6">
            <div className="space-y-4">
              <Button
                onClick={handleGrantConsent}
                size="lg"
                className="w-full bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                <Shield className="w-5 h-5 mr-2" />
                Grant Admin Consent
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-slate-900 px-2 text-slate-500">or</span>
                </div>
              </div>

              <Button
                onClick={() => setShowShareOption(true)}
                size="lg"
                variant="outline"
                className="w-full border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                I'm not a Global Admin
              </Button>
            </div>
          </div>

          {/* Already granted option */}
          <Button
            onClick={handleVerify}
            disabled={isVerifying}
            variant="ghost"
            className="text-slate-400 hover:text-white"
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
        </>
      ) : (
        <>
          {/* Share link option */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 mb-6 text-left">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-slate-300 mb-2">
                  <strong>Intune Administrators</strong> cannot grant admin
                  consent. Please share this link with your Global
                  Administrator:
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 bg-slate-950 px-3 py-2 rounded-lg text-xs text-slate-400 overflow-hidden text-ellipsis whitespace-nowrap">
                {shareableUrl}
              </code>
              <Button
                onClick={handleCopyLink}
                size="sm"
                variant="outline"
                className="border-slate-700 flex-shrink-0"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>

            <p className="text-xs text-slate-500 mt-4">
              After the Global Admin grants consent, come back here and click
              "Verify" below.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-center gap-4">
            <Button
              onClick={() => setShowShareOption(false)}
              variant="ghost"
              className="text-slate-400 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <Button
              onClick={handleVerify}
              disabled={isVerifying}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Verify Consent
                </>
              )}
            </Button>
          </div>
        </>
      )}

      {/* Back button */}
      <div className="mt-8">
        <Button
          onClick={onBack}
          variant="ghost"
          className="text-slate-500 hover:text-slate-300"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to welcome
        </Button>
      </div>
    </div>
  );
}
