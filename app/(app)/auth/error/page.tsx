'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { T, Var } from "gt-next";
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, { title: string; description: string }> = {
    Configuration: {
      title: 'Configuration Error',
      description: 'There is a problem with the server configuration. Please contact support.',
    },
    AccessDenied: {
      title: 'Access Denied',
      description: 'You do not have permission to access this application. Please ensure your account has the required Intune permissions.',
    },
    Verification: {
      title: 'Verification Error',
      description: 'The verification link may have expired or already been used.',
    },
    OAuthSignin: {
      title: 'Sign In Error',
      description: 'There was an error starting the sign in process. Please try again.',
    },
    OAuthCallback: {
      title: 'Callback Error',
      description: 'There was an error during the authentication callback. Please try again.',
    },
    OAuthCreateAccount: {
      title: 'Account Creation Error',
      description: 'Could not create your account. Please try again or contact support.',
    },
    EmailCreateAccount: {
      title: 'Account Creation Error',
      description: 'Could not create account with this email. It may already be in use.',
    },
    Callback: {
      title: 'Callback Error',
      description: 'There was an error during authentication. Please try again.',
    },
    OAuthAccountNotLinked: {
      title: 'Account Not Linked',
      description: 'This email is already associated with another sign-in method.',
    },
    default: {
      title: 'Authentication Error',
      description: 'An unexpected error occurred during authentication. Please try again.',
    },
  };

  const { title, description } = errorMessages[error || ''] || errorMessages.default;

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-deepest">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-red-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md px-6">
        <div className="glass-dark rounded-2xl p-8 shadow-xl text-center">
          <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="w-8 h-8 text-red-500" />
          </div>

          <h1 className="text-2xl font-bold text-text-primary mb-2"><T><Var>{title}</Var></T></h1>
          <p className="text-text-muted mb-8"><T><Var>{description}</Var></T></p>

          {error && (
            <div className="mb-6 p-3 bg-bg-elevated/50 rounded-lg">
              <p className="text-text-muted text-sm font-mono">
                <T>Error code: <Var>{error}</Var></T>
              </p>
            </div>
          )}

          <div className="space-y-3">
            <Link href="/auth/signin">
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                <T>Try Again</T>
              </Button>
            </Link>

            <Link href="/">
              <Button variant="outline" className="w-full border-overlay/15 text-text-secondary hover:bg-overlay/10">
                <T>Back to Home</T>
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-bg-deepest">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
