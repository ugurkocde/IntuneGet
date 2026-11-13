'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Building2, CheckCircle, Loader2, Mail, ShieldCheck, User, XCircle } from 'lucide-react';
import { T, Var } from 'gt-next';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';

interface ApprovalInfo {
  organization_name: string;
  requested_by: string | null;
  signed_in_as: string;
  can_approve: boolean;
  blocked_reason: string | null;
  blocked_message: string | null;
  approver_roles: string[];
}

type Outcome = 'granted' | 'already_managed' | 'permissions_incomplete' | 'declined';

/** Outcome codes the consent callback can pass in the URL. Fixed texts only. */
function CallbackError({ code }: { code: string }) {
  switch (code) {
    case 'consent_denied':
    case 'consent_not_granted':
      return <T>Consent was not granted at Microsoft, so nothing was changed. Open the link from your service provider again to retry.</T>;
    case 'request_closed':
      return <T>This request has already been completed.</T>;
    case 'request_not_found':
      return <T>This request no longer exists. Ask your service provider for a new link.</T>;
    case 'invalid_state':
      return <T>This link is invalid or has expired. Ask your service provider for a new one.</T>;
    default:
      return <T>Something went wrong and nothing was changed. Open the link from your service provider again to retry.</T>;
  }
}

function ApproveContent() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const callbackError = searchParams.get('error');

  const { isAuthenticated, isInitializing, signIn, signOut, getAccessToken } = useMicrosoftAuth();

  const [info, setInfo] = useState<ApprovalInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [reloadDetails, setReloadDetails] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !state || callbackError) return;
    const controller = new AbortController();
    const loadInfo = async () => {
      setIsLoading(true);
      setInfo(null);
      setOrganizationName(null);
      setError(null);
      try {
        const accessToken = await getAccessToken();
        if (controller.signal.aborted || !accessToken) return;
        const response = await fetch(`/api/msp/tenants/consent-approval?state=${encodeURIComponent(state)}`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setError(data.message || 'This request could not be loaded.');
          return;
        }
        setInfo(data as ApprovalInfo);
        setOrganizationName(data.organization_name);
      } catch {
        if (!controller.signal.aborted) setError('This request could not be loaded. Check your connection and try again.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void loadInfo();
    return () => controller.abort();
  }, [isAuthenticated, state, callbackError, getAccessToken, reloadDetails]);

  const handleSignIn = async (selectAccount: boolean) => {
    setIsSigningIn(true);
    setError(null);
    try {
      if (await signIn({ selectAccount })) {
        setReloadDetails(value => !value);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleApprove = async () => {
    if (!state) return;
    setIsApproving(true);
    setError(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError('Your session has ended. Sign in again to continue.');
        return;
      }
      const response = await fetch('/api/msp/tenants/consent-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ state }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.message || 'The approval could not be saved. Please try again.');
        return;
      }
      setOutcome(data.status as Outcome);
    } catch {
      setError('The approval could not be saved. Check your connection and try again.');
    } finally {
      setIsApproving(false);
    }
  };

  if (callbackError || !state) {
    return (
      <div className="text-center" role="alert">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-2"><T>This request cannot be completed</T></h1>
        <p className="text-text-muted">
          <CallbackError code={callbackError || 'invalid_state'} />
        </p>
      </div>
    );
  }

  if (outcome === 'granted' || outcome === 'already_managed') {
    return (
      <div className="text-center" role="status">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-2">
          {outcome === 'granted' ? <T>Access approved</T> : <T>Already connected</T>}
        </h1>
        <p className="text-text-muted mb-6">
          {outcome === 'granted' ? (
            <T><Var><strong className="text-text-primary">{organizationName}</strong></Var> can now manage Intune apps for your organization through IntuneGet. You can close this page.</T>
          ) : (
            <T>Your organization is already connected to <Var><strong className="text-text-primary">{organizationName}</strong></Var>. Nothing was changed.</T>
          )}
        </p>
        <p className="text-xs text-text-muted mb-4">
          <T>To end this access later, ask the service provider to remove your organization, or remove the IntuneGet enterprise application in Microsoft Entra.</T>
        </p>
        <Button variant="outline" onClick={() => signOut()} className="w-full">
          <T>Sign out</T>
        </Button>
      </div>
    );
  }

  if (outcome === 'declined') {
    return (
      <div className="text-center" role="status">
        <h1 className="text-xl font-semibold text-text-primary mb-2"><T>Request declined</T></h1>
        <p className="text-text-muted"><T>Nothing was changed. You can close this page.</T></p>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-accent-cyan" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-cyan/10 flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-accent-cyan" />
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-2">
          <T>Approve access for a service provider</T>
        </h1>
        <p className="text-text-muted">
          <T>A managed service provider asked to manage Intune apps for your organization through IntuneGet. An administrator of your organization has to approve this.</T>
        </p>
      </div>

      {!isAuthenticated && (
        <div className="space-y-3">
          <p className="text-sm text-text-muted text-center">
            <T>Sign in with an administrator account of your organization to see who is asking.</T>
          </p>
          <Button onClick={() => handleSignIn(false)} disabled={isSigningIn} className="w-full">
            {isSigningIn ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <T>Signing in...</T>
              </>
            ) : (
              <T>Sign in with Microsoft</T>
            )}
          </Button>
        </div>
      )}

      {isAuthenticated && isLoading && (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="w-6 h-6 animate-spin text-accent-cyan" />
        </div>
      )}

      {isAuthenticated && info && (
        <>
          <div className="bg-overlay/5 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Building2 className="w-5 h-5 text-text-muted flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-secondary"><T>Service provider asking for access</T></p>
                <p className="font-medium text-text-primary break-words">{info.organization_name}</p>
              </div>
            </div>
            {info.requested_by && (
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-text-muted flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-text-secondary"><T>Requested by</T></p>
                  <p className="font-medium text-text-primary break-words">{info.requested_by}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-text-muted flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs text-text-secondary"><T>You are signed in as</T></p>
                <p className="font-medium text-text-primary truncate">{info.signed_in_as}</p>
              </div>
            </div>
          </div>

          {info.can_approve ? (
            <>
              <div className="text-sm text-text-secondary space-y-2">
                <p><T>If you approve, members of this service provider can:</T></p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><T>See the apps, groups and devices in your Intune tenant</T></li>
                  <li><T>Deploy, update and assign apps to your devices</T></li>
                </ul>
                <p className="text-xs text-text-muted">
                  <T>Only approve if you know this service provider and the person who sent the request, and you expected it. The name above was chosen by the service provider.</T>
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="flex-1 bg-accent-cyan-dim hover:bg-accent-cyan-dim hover:brightness-90 text-white"
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      <T>Approving...</T>
                    </>
                  ) : (
                    <T>Approve</T>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setOutcome('declined')} disabled={isApproving} className="flex-1">
                  <T>Decline</T>
                </Button>
              </div>
            </>
          ) : (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl" role="alert">
              <p className="text-sm text-text-primary">{info.blocked_message}</p>
            </div>
          )}
        </>
      )}

      {outcome === 'permissions_incomplete' && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl" role="status">
          <p className="text-sm text-text-primary">
            <T>Your approval is saved, but the IntuneGet permissions are not active in your tenant yet. Microsoft can take a few minutes after consent. Press Approve again in a few minutes.</T>
          </p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl" role="alert">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {isAuthenticated && !isLoading && (
        <button
          type="button"
          onClick={() => handleSignIn(true)}
          disabled={isSigningIn}
          className="mx-auto block text-sm text-text-muted hover:text-text-primary transition-colors"
        >
          <T>Use another account</T>
        </button>
      )}
    </div>
  );
}

export default function ApproveMspLinkPage() {
  return (
    <div className="min-h-screen bg-bg-surface flex items-center justify-center p-4">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-accent-cyan/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-accent-violet/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        <Link href="/" className="flex items-center justify-center gap-3 mb-6">
          <Image src="/favicon.svg" alt="IntuneGet" width={40} height={40} className="rounded-lg" />
          <span className="text-2xl font-bold text-text-primary">IntuneGet</span>
        </Link>

        <main className="bg-bg-elevated rounded-2xl border border-overlay/10 p-6 shadow-xl">
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-accent-cyan" />
              </div>
            }
          >
            <ApproveContent />
          </Suspense>
        </main>

        <p className="text-center text-sm text-text-secondary mt-4">
          <Link href="/" className="hover:text-accent-cyan-dim transition-colors">
            <T>Learn more about IntuneGet</T>
          </Link>
        </p>
      </div>
    </div>
  );
}
