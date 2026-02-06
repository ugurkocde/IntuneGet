'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Loader2, CheckCircle, XCircle, Mail, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { getRoleDisplayName } from '@/lib/msp-permissions';
import type { MspRole } from '@/lib/msp-permissions';

interface InvitationInfo {
  valid: boolean;
  email: string;
  role: MspRole;
  organization_name: string;
  expires_at: string;
}

function AcceptInvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [invitationInfo, setInvitationInfo] = useState<InvitationInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { isAuthenticated, signIn, getAccessToken } = useMicrosoftAuth();

  // Validate token on mount
  useEffect(() => {
    async function validateToken() {
      if (!token) {
        setError('No invitation token provided');
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/msp/invitations/accept?token=${token}`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Invalid invitation');
        } else {
          setInvitationInfo(data);
        }
      } catch {
        setError('Failed to validate invitation');
      } finally {
        setIsLoading(false);
      }
    }

    validateToken();
  }, [token]);

  // Handle sign in
  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signIn();
    } catch {
      setError('Failed to sign in');
    } finally {
      setIsSigningIn(false);
    }
  };

  // Accept invitation when authenticated
  const handleAccept = async () => {
    if (!token) return;

    setIsAccepting(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setError('Please sign in first');
        setIsAccepting(false);
        return;
      }

      const response = await fetch('/api/msp/invitations/accept', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || data.error || 'Failed to accept invitation');
      } else {
        setSuccess(true);
        // Redirect to dashboard after 2 seconds
        setTimeout(() => {
          router.push('/dashboard/msp');
        }, 2000);
      }
    } catch {
      setError('Failed to accept invitation');
    } finally {
      setIsAccepting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-accent-cyan" />
      </div>
    );
  }

  if (error && !invitationInfo) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">Invalid Invitation</h2>
        <p className="text-text-muted mb-6">{error}</p>
        <Button onClick={() => router.push('/')}>Go to Home</Button>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">Welcome to the Team!</h2>
        <p className="text-text-muted mb-6">
          You have successfully joined {invitationInfo?.organization_name}.
        </p>
        <Button
          onClick={() => router.push('/dashboard/msp')}
          className="w-full bg-accent-cyan hover:bg-accent-cyan/90 text-white"
        >
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Organization info */}
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent-cyan/10 flex items-center justify-center">
          <Mail className="w-8 h-8 text-accent-cyan" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          You&apos;ve Been Invited!
        </h2>
        <p className="text-text-muted">
          Join <span className="font-medium text-text-primary">{invitationInfo?.organization_name}</span> on IntuneGet
        </p>
      </div>

      {/* Invitation details */}
      <div className="bg-black/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-text-muted" />
          <div>
            <p className="text-xs text-text-muted">Invited email</p>
            <p className="font-medium text-text-primary">{invitationInfo?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-text-muted" />
          <div>
            <p className="text-xs text-text-muted">Your role</p>
            <p className="font-medium text-text-primary">
              {invitationInfo?.role && getRoleDisplayName(invitationInfo.role)}
            </p>
          </div>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Action buttons */}
      {isAuthenticated ? (
        <Button
          onClick={handleAccept}
          disabled={isAccepting}
          className="w-full bg-accent-cyan hover:bg-accent-cyan/90 text-white"
        >
          {isAccepting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Accepting...
            </>
          ) : (
            'Accept Invitation'
          )}
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text-muted text-center">
            Sign in with your Microsoft account to accept this invitation.
          </p>
          <Button
            onClick={handleSignIn}
            disabled={isSigningIn}
            className="w-full"
          >
            {isSigningIn ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Signing in...
              </>
            ) : (
              'Sign in with Microsoft'
            )}
          </Button>
        </div>
      )}

      {/* Note about email matching */}
      <p className="text-xs text-text-muted text-center">
        You must sign in with the same email address this invitation was sent to: <strong>{invitationInfo?.email}</strong>
      </p>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="min-h-screen bg-bg-surface flex items-center justify-center p-4">
      {/* Background decorations */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-accent-cyan/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-accent-violet/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-3 mb-6">
          <Image
            src="/favicon.svg"
            alt="IntuneGet"
            width={40}
            height={40}
            className="rounded-lg"
          />
          <span className="text-2xl font-bold text-text-primary">IntuneGet</span>
        </Link>

        <div className="bg-bg-elevated rounded-2xl border border-black/10 p-6 shadow-xl">
          <Suspense
            fallback={
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-accent-cyan" />
              </div>
            }
          >
            <AcceptInvitationContent />
          </Suspense>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-text-muted mt-4">
          <Link href="/" className="hover:text-accent-cyan transition-colors">
            Learn more about IntuneGet
          </Link>
        </p>
      </div>
    </div>
  );
}
