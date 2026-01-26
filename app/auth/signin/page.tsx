'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { Shield, Zap, Cloud, CheckCircle2, Loader2, Package, ChevronDown, Copy, Check, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { getAdminConsentUrl } from '@/lib/msal-config';
import { isOnboardingCacheValid } from '@/lib/onboarding-utils';
import { trackSigninClick } from '@/hooks/useLandingStats';

// Microsoft logo SVG component
function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 21 21"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

const features = [
  {
    icon: Cloud,
    title: 'Direct Intune Integration',
    description: 'Deploy Win32 apps directly to your Intune tenant',
  },
  {
    icon: Zap,
    title: 'Winget Powered',
    description: 'Access 10,000+ apps from the Winget repository',
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'Secure authentication with Microsoft Entra ID',
  },
];

function SignInContent() {
  const { isAuthenticated, signIn } = useMicrosoftAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConsentSectionOpen, setIsConsentSectionOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';
  const consentUrl = typeof window !== 'undefined' ? getAdminConsentUrl() : '';

  const handleCopyConsentUrl = async () => {
    try {
      await navigator.clipboard.writeText(consentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Redirect based on onboarding status if already signed in
  // First-time users go to /onboarding, returning users go to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      // Check if user has completed onboarding (valid cache)
      const onboardingComplete = isOnboardingCacheValid();
      if (onboardingComplete) {
        router.push(callbackUrl);
      } else {
        // First-time user or cache expired - go to onboarding
        router.push('/onboarding');
      }
    }
  }, [isAuthenticated, router, callbackUrl]);

  const handleSignIn = async () => {
    // Track signin click (fire-and-forget)
    trackSigninClick();

    setIsSigningIn(true);
    setError(null);
    try {
      const success = await signIn();
      if (!success) {
        setError('Sign in was cancelled or failed. Please try again.');
      }
    } catch (err) {
      console.error('Sign in failed:', err);
      setError('An error occurred during sign in. Please try again.');
    } finally {
      setIsSigningIn(false);
    }
  };

  // Show loading state while checking auth or if already authenticated
  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-slate-400">Redirecting to your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />

        {/* Decorative elements */}
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        </div>

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          {/* Logo and title */}
          <div className="flex items-center gap-4 mb-12">
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/30 rounded-full blur-xl" />
              <div className="relative w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                <Package className="w-8 h-8 text-white" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">IntuneGet</h1>
              <p className="text-slate-400">Winget for Intune</p>
            </div>
          </div>

          {/* Tagline */}
          <h2 className="text-4xl xl:text-5xl font-bold text-white mb-6 leading-tight">
            Simplify Windows
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
              App Deployment
            </span>
          </h2>

          <p className="text-lg text-slate-400 mb-12 max-w-md leading-relaxed">
            Deploy Win32 applications to Microsoft Intune with ease. Search Winget, configure, and upload in minutes.
          </p>

          {/* Features */}
          <div className="space-y-6">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className="flex items-start gap-4"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex-shrink-0 p-2.5 rounded-xl bg-white/5 border border-white/10">
                  <feature.icon className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-white">{feature.title}</h3>
                  <p className="text-sm text-slate-400">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Trust badge */}
          <div className="mt-12 flex items-center gap-3 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Multi-tenant support - works with any Entra ID tenant</span>
          </div>
        </div>
      </div>

      {/* Right side - Sign in form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden flex flex-col items-center mb-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-xl" />
              <div className="relative w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                <Package className="w-10 h-10 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-white">IntuneGet</h1>
            <p className="text-slate-400 text-sm">Winget for Intune</p>
          </div>

          {/* Sign in card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl p-4 sm:p-6 md:p-8 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-white">Welcome</h2>
              <p className="text-slate-400">
                Sign in to deploy apps to your Intune tenant
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-400 text-sm text-center">{error}</p>
              </div>
            )}

            {/* Sign in button */}
            <Button
              onClick={handleSignIn}
              disabled={isSigningIn}
              size="lg"
              className="w-full h-12 text-base font-medium gap-3 bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl transition-all"
            >
              {isSigningIn ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <MicrosoftLogo className="h-5 w-5" />
                  Sign in with Microsoft
                </>
              )}
            </Button>

            {/* Admin consent info */}
            <p className="text-xs text-slate-500 text-center">
              IntuneGet requires admin consent to deploy apps to your tenant.
            </p>

            {/* Collapsible consent link section */}
            <div className="space-y-3">
              <button
                onClick={() => setIsConsentSectionOpen(!isConsentSectionOpen)}
                className="w-full flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-300 transition-colors py-1"
              >
                <span>Can&apos;t sign in? Get consent link</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    isConsentSectionOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <div
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  isConsentSectionOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4 space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="text-amber-200 font-medium">Global Admin Required</p>
                      <p className="text-amber-200/70 mt-1">
                        Only Global Administrators can grant the permissions IntuneGet needs.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-slate-400 font-medium">
                      Share this link with your Global Administrator:
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        readOnly
                        value={consentUrl}
                        className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-300 truncate focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                      <Button
                        onClick={handleCopyConsentUrl}
                        size="sm"
                        variant="outline"
                        className="flex-shrink-0 border-slate-700 hover:bg-slate-800 text-slate-300"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">
                    Once they grant consent, you can sign in normally.
                  </p>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-slate-900 px-2 text-slate-500">
                  Secure authentication
                </span>
              </div>
            </div>

            {/* Info text */}
            <div className="space-y-4 text-center">
              <p className="text-sm text-slate-400">
                Sign in with your Microsoft work or school account to access your Intune tenant.
              </p>
              <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                <Shield className="h-3.5 w-3.5" />
                <span>Protected by Microsoft Entra ID</span>
              </div>
            </div>
          </div>

          {/* Required permissions */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h3 className="text-slate-400 text-sm font-medium mb-3">
              Required Permissions:
            </h3>
            <ul className="text-slate-500 text-sm space-y-2">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Read and write device management apps
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Read your profile information
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Read group memberships
              </li>
            </ul>
          </div>

          {/* Self-hosting info */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 text-center">
            <p className="text-sm text-slate-400">
              Prefer to self-host? IntuneGet is open source.{' '}
              <Link
                href="/docs/docker"
                className="text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 transition-colors"
              >
                Self-hosting guide
                <ExternalLink className="h-3 w-3" />
              </Link>
            </p>
          </div>

          {/* Footer link */}
          <p className="text-center text-sm text-slate-600">
            <Link href="/" className="hover:text-slate-400 transition-colors">
              Back to home
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-950">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
