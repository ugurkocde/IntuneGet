'use client';

import { useEffect, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { markConsentGranted, verifyConsentApi } from '@/components/AdminConsentBanner';

function ConsentCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, isAuthenticated, getAccessToken } = useMicrosoftAuth();
  const [status, setStatus] = useState<'processing' | 'verifying' | 'success' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Processing admin consent...');

  /**
   * Verify consent via API after sign-in
   */
  const verifyConsentAfterSignIn = useCallback(async (): Promise<boolean> => {
    try {
      const token = await getAccessToken();
      if (!token) {
        console.warn('No access token available for verification');
        return true; // Proceed anyway
      }
      return await verifyConsentApi(token);
    } catch {
      console.warn('Error verifying consent, proceeding anyway');
      return true;
    }
  }, [getAccessToken]);

  useEffect(() => {
    // Check for error in URL params (admin consent can fail)
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      setStatus('error');
      setErrorMessage(errorDescription || `Admin consent failed: ${error}`);
      return;
    }

    // Admin consent URL redirect was successful!
    // The admin_consent parameter indicates success from Entra ID
    const adminConsent = searchParams.get('admin_consent');
    if (adminConsent === 'True' || !error) {
      // Mark consent as granted in localStorage (will be verified after sign-in)
      markConsentGranted();
    }

    // Now sign in the user if not already authenticated
    const completeSetup = async () => {
      if (isAuthenticated) {
        // Already signed in - verify consent via API
        setStatus('verifying');
        setStatusMessage('Verifying organization access...');

        const verified = await verifyConsentAfterSignIn();
        if (verified) {
          setStatus('success');
          setStatusMessage('Your organization is now connected.');
          setTimeout(() => router.push('/onboarding?step=3'), 1500);
        } else {
          setStatus('error');
          setErrorMessage('Admin consent was not granted. Please ensure a Global Administrator grants consent.');
        }
        return;
      }

      // Not authenticated - try to sign in
      setStatusMessage('Signing you in...');
      try {
        const success = await signIn();
        if (success) {
          // Now verify consent
          setStatus('verifying');
          setStatusMessage('Verifying organization access...');

          const verified = await verifyConsentAfterSignIn();
          if (verified) {
            setStatus('success');
            setStatusMessage('Your organization is now connected.');
            setTimeout(() => router.push('/onboarding?step=3'), 1500);
          } else {
            setStatus('error');
            setErrorMessage('Admin consent was not granted. Please ensure a Global Administrator grants consent.');
          }
        } else {
          // Sign-in was cancelled - still redirect to sign-in page
          // (consent was granted, they can sign in later)
          setStatus('success');
          setStatusMessage('Consent recorded. Please sign in to continue.');
          setTimeout(() => router.push('/auth/signin'), 1500);
        }
      } catch {
        setStatus('error');
        setErrorMessage('Failed to complete sign in. Please try again.');
      }
    };

    completeSetup();
  }, [searchParams, signIn, isAuthenticated, router, verifyConsentAfterSignIn]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="text-center max-w-md px-4">
        {(status === 'processing' || status === 'verifying') && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              {status === 'verifying' ? 'Verifying Access' : 'Completing Setup'}
            </h2>
            <p className="text-slate-400">
              {statusMessage}
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              Setup Complete
            </h2>
            <p className="text-slate-400">
              {statusMessage}
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">
              Setup Failed
            </h2>
            <p className="text-slate-400 mb-4">
              {errorMessage || 'Something went wrong during setup.'}
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => router.push('/auth/signin')}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                Try Again
              </Button>
              <p className="text-xs text-slate-500 mt-4">
                Note: Admin consent requires a Global Administrator or
                Privileged Role Administrator account.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConsentCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
        </div>
      }
    >
      <ConsentCallbackContent />
    </Suspense>
  );
}
