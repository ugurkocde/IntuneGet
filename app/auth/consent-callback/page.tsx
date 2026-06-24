'use client';

import { useEffect, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { T, Var } from "gt-next";
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { markConsentGranted, markConsentPending, verifyConsentApiDetailed } from '@/components/AdminConsentBanner';

function ConsentCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, isAuthenticated, getAccessToken, refreshToken } = useMicrosoftAuth();
  const [status, setStatus] = useState<'processing' | 'verifying' | 'success' | 'error' | 'propagating'>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 'role': Microsoft rejected the consent request (often a missing admin role).
  // 'verification': consent completed but server-side verification failed - usually
  // permission propagation or, when self-hosting, an app-registration/credential
  // misconfiguration rather than the user's role.
  const [errorKind, setErrorKind] = useState<'role' | 'verification'>('role');
  const [statusMessage, setStatusMessage] = useState('Processing admin consent...');

  /**
   * Verify consent via API after sign-in.
   * Returns { verified, error, message } so the caller can distinguish between
   * genuine failures and Microsoft's post-consent propagation delay.
   */
  const verifyConsentAfterSignIn = useCallback(async (): Promise<{
    verified: boolean;
    error?: string | null;
    message?: string;
  }> => {
    try {
      // Force-refresh the MSAL token so new scopes from fresh admin consent are
      // included. Without this, the cached token may still reflect pre-consent state.
      const token = (await refreshToken()) || (await getAccessToken());
      if (!token) {
        console.warn('No access token available for verification');
        return {
          verified: false,
          error: 'network_error',
          message: 'Could not acquire an access token. Please sign in again.',
        };
      }
      // justConsented hint lets the API return a friendlier "propagating" error
      // instead of "insufficient permissions" during Microsoft's role-claim delay.
      const result = await verifyConsentApiDetailed(token, { justConsented: true });
      return {
        verified: result.verified === true,
        error: result.error,
        message: result.message,
      };
    } catch {
      console.warn('Error verifying consent');
      return {
        verified: false,
        error: 'network_error',
        message: 'Unable to verify consent. Please check your connection and try again.',
      };
    }
  }, [getAccessToken, refreshToken]);

  useEffect(() => {
    // When the effect re-runs (e.g., because `isAuthenticated` flipped
    // false → true after MSAL finished rehydrating), the old run's cleanup
    // sets `cancelled = true` so its pending async work doesn't commit state.
    // The new run then proceeds cleanly without two concurrent flows racing
    // on markConsentGranted() / router.push().
    let cancelled = false;

    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (error) {
      setStatus('error');
      setErrorKind('role');
      setErrorMessage(errorDescription || `Admin consent failed: ${error}`);
      return;
    }

    const handleVerificationFailure = (result: { error?: string | null; message?: string }) => {
      if (cancelled) return;
      if (result.error === 'consent_propagating') {
        // Consent was actually granted; Microsoft is still propagating role
        // claims. Record a time-bounded pending flag so subsequent banner
        // checks surface the same "please wait" message instead of flipping
        // to "re-grant consent".
        markConsentPending();
        setStatus('propagating');
        setErrorMessage(
          result.message ||
          'Consent was granted. Microsoft is still propagating the new permissions (5-15 minutes). Please check again shortly from the Settings page.'
        );
        return;
      }
      setStatus('error');
      setErrorKind('verification');
      setErrorMessage(
        result.message || 'Admin consent was not granted. Please ensure a Global Administrator grants consent.'
      );
    };

    const completeSetup = async () => {
      if (isAuthenticated) {
        if (cancelled) return;
        setStatus('verifying');
        setStatusMessage('Verifying organization access...');

        const result = await verifyConsentAfterSignIn();
        if (cancelled) return;
        if (result.verified) {
          markConsentGranted();
          setStatus('success');
          setStatusMessage('Your organization is now connected.');
          setTimeout(() => {
            if (!cancelled) router.push('/onboarding?step=3');
          }, 1500);
        } else {
          handleVerificationFailure(result);
        }
        return;
      }

      // Not authenticated - try to sign in
      setStatusMessage('Signing you in...');
      try {
        const success = await signIn();
        if (cancelled) return;
        if (success) {
          setStatus('verifying');
          setStatusMessage('Verifying organization access...');

          const result = await verifyConsentAfterSignIn();
          if (cancelled) return;
          if (result.verified) {
            markConsentGranted();
            setStatus('success');
            setStatusMessage('Your organization is now connected.');
            setTimeout(() => {
              if (!cancelled) router.push('/onboarding?step=3');
            }, 1500);
          } else {
            handleVerificationFailure(result);
          }
        } else {
          // Sign-in was cancelled - redirect to sign-in page without marking consent
          setStatus('success');
          setStatusMessage('Please sign in to continue.');
          setTimeout(() => {
            if (!cancelled) router.push('/auth/signin');
          }, 1500);
        }
      } catch {
        if (cancelled) return;
        setStatus('error');
        setErrorKind('verification');
        setErrorMessage('Failed to complete sign in. Please try again.');
      }
    };

    completeSetup();

    return () => {
      cancelled = true;
    };
  }, [searchParams, signIn, isAuthenticated, router, verifyConsentAfterSignIn]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-deepest">
      <div className="text-center max-w-md px-4">
        {(status === 'processing' || status === 'verifying') && (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              {status === 'verifying' ? <T>Verifying Access</T> : <T>Completing Setup</T>}
            </h2>
            <p className="text-text-muted">
              <T><Var>{statusMessage}</Var></T>
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              <T>Setup Complete</T>
            </h2>
            <p className="text-text-muted">
              <T><Var>{statusMessage}</Var></T>
            </p>
          </>
        )}

        {status === 'propagating' && (
          <>
            <Loader2 className="h-12 w-12 text-blue-400 animate-spin mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              <T>Finalizing Setup</T>
            </h2>
            <p className="text-text-muted mb-4">
              <T><Var>{errorMessage || 'Consent was granted. Microsoft is still propagating the new permissions - this typically takes 5 to 15 minutes.'}</Var></T>
            </p>
            <div className="space-y-2">
              <Button
                onClick={() => router.push('/dashboard/settings?tab=permissions')}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                <T>Go to Settings</T>
              </Button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              <T>Admin Consent Not Granted</T>
            </h2>
            <p className="text-text-muted mb-4">
              <T><Var>{errorMessage || 'Something went wrong during setup.'}</Var></T>
            </p>

            {/* Detailed explanation - tailored to the failure kind */}
            <div className="bg-bg-surface/50 border border-overlay/10 rounded-xl p-4 mb-4 text-left">
              <p className="text-sm text-amber-400 font-medium mb-2">
                <T>Why did this happen?</T>
              </p>
              {errorKind === 'role' ? (
                <ul className="text-xs text-text-muted space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-text-muted mt-0.5">1.</span>
                    <span><T>You may not have the required role. Only <Var><strong className="text-text-primary">Global Administrators</strong></Var> or <Var><strong className="text-text-primary">Privileged Role Administrators</strong></Var> can grant admin consent.</T></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-text-muted mt-0.5">2.</span>
                    <span><T>Intune Administrators, Application Administrators, and other roles <Var><strong className="text-red-400">cannot</strong></Var> grant organization-wide consent.</T></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-text-muted mt-0.5">3.</span>
                    <span><T>If you&apos;re not sure of your role, ask your IT department who the Global Admin is.</T></span>
                  </li>
                </ul>
              ) : (
                <ul className="text-xs text-text-muted space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-text-muted mt-0.5">1.</span>
                    <span><T>Consent may still be propagating. Microsoft can take 5-15 minutes to apply new permissions - wait a few minutes, then re-check from the Settings page.</T></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-text-muted mt-0.5">2.</span>
                    <span><T>If you are <Var><strong className="text-text-primary">self-hosting</strong></Var>, confirm the app registration is configured correctly: <Var><strong className="text-text-primary">AZURE_CLIENT_ID</strong></Var> and <Var><strong className="text-text-primary">AZURE_CLIENT_SECRET</strong></Var> are set, the required Microsoft Graph application permissions are added, and this app&apos;s redirect URI matches your deployment URL.</T></span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-text-muted mt-0.5">3.</span>
                    <span><T>A valid, unexpired client secret is required - regenerate it in Entra if it may have expired.</T></span>
                  </li>
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <Button
                onClick={() => router.push('/onboarding?step=2')}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {errorKind === 'role' ? <T>Go Back and Request from Admin</T> : <T>Try Again</T>}
              </Button>
              <Button
                onClick={() => router.push('/auth/signin')}
                variant="outline"
                className="w-full border-overlay/15 text-text-secondary hover:bg-overlay/10"
              >
                <T>Start Over</T>
              </Button>
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
        <div className="min-h-screen flex items-center justify-center bg-bg-deepest">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
        </div>
      }
    >
      <ConsentCallbackContent />
    </Suspense>
  );
}
