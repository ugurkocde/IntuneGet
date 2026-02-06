'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Shield, Loader2, Package, ChevronDown, Copy, Check, AlertTriangle, Users, Boxes, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { getAdminConsentUrl } from '@/lib/msal-config';
import { markOnboardingComplete, clearOnboardingCache } from '@/lib/onboarding-utils';
import { trackSigninClick, useLandingStats } from '@/hooks/useLandingStats';
import { GradientOrb } from '@/components/landing/ui/GradientOrb';
import { GridBackground } from '@/components/landing/ui/GridBackground';
import { FadeIn } from '@/components/landing/animations/FadeIn';
import { CountUp } from '@/components/landing/animations/CountUp';
import { springPresets } from '@/lib/animations/variants';

// Microsoft logo SVG component -- colors per official brand spec
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

function SignInContent() {
  const { isAuthenticated, signIn, getAccessToken } = useMicrosoftAuth();
  const { signinClicks, appsSupported } = useLandingStats();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isVerifyingConsent, setIsVerifyingConsent] = useState(false);
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

  /**
   * Verify consent status via API (server-side check)
   * Returns true if consent is granted and permissions are valid
   */
  const verifyConsentStatus = useCallback(async (): Promise<boolean> => {
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
    } catch {
      return false;
    }
  }, [getAccessToken]);

  // Redirect based on ACTUAL consent status (server-verified, not localStorage)
  // This ensures users with revoked/incomplete consent are sent to onboarding
  useEffect(() => {
    if (isAuthenticated && !isVerifyingConsent) {
      setIsVerifyingConsent(true);

      verifyConsentStatus().then((isVerified) => {
        if (isVerified) {
          // Consent verified - update cache and go to dashboard
          markOnboardingComplete();
          router.push(callbackUrl);
        } else {
          // Consent not granted or incomplete - clear stale cache and go to onboarding
          clearOnboardingCache();
          router.push('/onboarding');
        }
      });
    }
  }, [isAuthenticated, router, callbackUrl, verifyConsentStatus, isVerifyingConsent]);

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

  // Show loading state while checking auth or verifying consent
  if (isAuthenticated || isVerifyingConsent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-deepest">
        <motion.div
          className="flex flex-col items-center gap-6"
          initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="relative">
            <div className="absolute inset-0 bg-accent-cyan/10 rounded-full blur-2xl animate-pulse" />
            <div className="relative w-16 h-16 bg-gradient-to-br from-accent-cyan to-accent-violet rounded-2xl flex items-center justify-center shadow-glow-cyan">
              <Loader2 className="h-7 w-7 animate-spin text-white" />
            </div>
          </div>
          <p className="text-stone-500 text-sm font-medium">
            {isVerifyingConsent ? 'Verifying permissions...' : 'Redirecting to your dashboard...'}
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg-deepest">
      {/* Mobile background glow */}
      <div className="lg:hidden absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full opacity-30"
          style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.08) 0%, transparent 70%)' }}
        />
      </div>

      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden border-r border-stone-200/50">
        {/* Background layers */}
        <GridBackground variant="dots" opacity={0.3} className="absolute inset-0" />

        {/* Decorative gradient band */}
        <div
          className="absolute left-0 right-0 top-1/3 h-64 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, rgba(8, 145, 178, 0.04) 0%, rgba(124, 58, 237, 0.03) 50%, transparent 100%)',
          }}
        />

        {/* Gradient orbs */}
        <GradientOrb
          color="cyan"
          size="xl"
          className="left-1/4 top-1/3 -translate-x-1/2 -translate-y-1/2"
          intensity="medium"
        />
        <GradientOrb
          color="violet"
          size="lg"
          className="right-1/4 bottom-1/4 translate-x-1/2"
          intensity="low"
        />
        <GradientOrb
          color="mixed"
          size="sm"
          className="left-1/3 bottom-[15%]"
          intensity="low"
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20 max-w-[520px] mx-auto -mt-6">
          {/* Logo and title */}
          <FadeIn animateOnMount delay={0}>
            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-accent-cyan/20 rounded-full blur-xl" />
                <div className="relative w-14 h-14 bg-gradient-to-br from-accent-cyan to-accent-violet rounded-xl flex items-center justify-center shadow-glow-cyan">
                  <Package className="w-7 h-7 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-stone-900">IntuneGet</h1>
                <p className="text-stone-500 text-sm">Winget for Intune</p>
              </div>
            </div>
          </FadeIn>

          {/* Main Headline */}
          <motion.h2
            className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-[1.1] mb-6"
            initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <span className="gradient-text-cyan">10,000 Apps.</span>
            <br />
            <span className="text-stone-800">One Click.</span>
          </motion.h2>

          <FadeIn animateOnMount delay={0.1}>
            <p className="text-lg text-stone-600 mb-6 max-w-md leading-relaxed">
              Deploy Win32 applications to Microsoft Intune with ease.
              Search Winget, configure, and upload in minutes.
            </p>
          </FadeIn>

          {/* Gradient separator line */}
          <div className="h-px w-3/4 bg-gradient-to-r from-transparent via-accent-cyan/30 to-transparent mb-5" />

          {/* Trust stats */}
          <FadeIn animateOnMount delay={0.15}>
            <p className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">Trusted by IT admins</p>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/60 border border-stone-200/40 shadow-soft">
                <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-accent-cyan" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-stone-900">
                    <CountUp end={signinClicks} suffix="+" duration={1.5} delay={0.3} />
                  </p>
                  <p className="text-sm text-stone-500">Admins</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/60 border border-stone-200/40 shadow-soft">
                <div className="w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-accent-violet" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-stone-900">
                    <CountUp end={appsSupported} suffix="+" duration={1.5} delay={0.4} />
                  </p>
                  <p className="text-sm text-stone-500">Apps available</p>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Multi-tenant badge */}
          <FadeIn animateOnMount delay={0.2}>
            <div className="mt-5 flex items-center gap-2 text-sm text-stone-500">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>Multi-tenant support - works with any Entra ID tenant</span>
            </div>
          </FadeIn>
        </div>

        {/* Cyan glow accent along divider */}
        <div
          className="absolute top-0 right-0 bottom-0 w-px pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, transparent 20%, rgba(8, 145, 178, 0.12) 50%, transparent 80%)',
          }}
        />
      </div>

      {/* Right side - Sign in form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-12 xl:px-20 relative overflow-hidden">
        {/* Right panel background texture */}
        <div className="hidden lg:block absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/3 w-[600px] h-[600px] rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.04) 0%, transparent 60%)' }}
          />
        </div>

        <div className="relative z-10 w-full max-w-[420px]">
          {/* Mobile logo */}
          <FadeIn animateOnMount className="lg:hidden flex flex-col items-center mb-8">
            <div className="relative mb-4">
              <div className="absolute inset-0 bg-accent-cyan/20 rounded-full blur-xl" />
              <div className="relative w-16 h-16 bg-gradient-to-br from-accent-cyan to-accent-violet rounded-2xl flex items-center justify-center shadow-glow-cyan">
                <Package className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-stone-900">IntuneGet</h1>
            <p className="text-stone-500 text-sm">Winget for Intune</p>
            {/* Mobile trust strip */}
            <div className="flex items-center gap-4 text-xs text-stone-500 mt-2">
              <span className="flex items-center gap-1.5">
                <Users className="w-3 h-3 text-accent-cyan" />
                {signinClicks.toLocaleString()}+ admins
              </span>
              <span className="w-px h-3 bg-stone-300" />
              <span className="flex items-center gap-1.5">
                <Boxes className="w-3 h-3 text-accent-violet" />
                {appsSupported.toLocaleString()}+ apps
              </span>
            </div>
          </FadeIn>

          {/* Sign in card */}
          <motion.div
            className="relative bg-white/95 backdrop-blur-sm border border-stone-200/80 rounded-2xl shadow-soft-lg overflow-hidden"
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/50 to-transparent" />

            {/* Card content with intentional spacing */}
            <div className="px-8 pt-10 pb-6 sm:px-10 sm:pt-12 sm:pb-8">
              <div className="text-center mb-10">
                <h2 className="text-2xl font-bold tracking-tight text-stone-900">Start Deploying</h2>
                <p className="text-stone-500 mt-2">
                  Sign in with your work account to get started
                </p>
              </div>

              {/* Error message */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl"
                  >
                    <p className="text-red-600 text-sm text-center">{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Sign in button -- Microsoft brand spec (dark theme variant) */}
              <motion.div
                whileHover={shouldReduceMotion ? {} : { scale: 1.01 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                transition={springPresets.snappy}
              >
                <Button
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  size="lg"
                  className="w-full h-[41px] text-sm font-semibold gap-3 rounded-[2px] bg-[#2f2f2f] hover:bg-[#1a1a1a] text-white border border-[#2f2f2f] hover:border-[#1a1a1a] transition-colors duration-150"
                >
                  {isSigningIn ? (
                    <>
                      <Loader2 className="h-[19px] w-[19px] animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <MicrosoftLogo className="h-[19px] w-[19px]" />
                      Sign in with Microsoft
                    </>
                  )}
                </Button>
              </motion.div>

              {/* Trust badge */}
              <div className="flex items-center justify-center gap-2 text-xs text-stone-400 mt-6">
                <Shield className="h-3.5 w-3.5 text-accent-cyan/70" />
                <span>Protected by Microsoft Entra ID</span>
              </div>
            </div>

            {/* Consent section -- visually separated as footer zone */}
            <div className="border-t border-stone-100 bg-stone-50/50 px-8 py-5 sm:px-10">
              <button
                onClick={() => setIsConsentSectionOpen(!isConsentSectionOpen)}
                className="w-full flex items-center justify-center gap-2 text-sm text-stone-400 hover:text-stone-600 transition-colors"
              >
                <span>Need admin consent?</span>
                <motion.div animate={{ rotate: isConsentSectionOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="h-4 w-4" />
                </motion.div>
              </button>

              <AnimatePresence initial={false}>
                {isConsentSectionOpen && (
                  <motion.div
                    key="consent-section"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="overflow-hidden"
                  >
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-4 mt-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-amber-800 font-medium">Global Admin Required</p>
                          <p className="text-amber-700 mt-1">
                            Only Global Administrators can grant the permissions IntuneGet needs.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-stone-500 font-medium">
                          Share this link with your Global Administrator:
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            readOnly
                            value={consentUrl}
                            className="flex-1 px-3 py-2 bg-white border border-stone-200 rounded-lg text-sm text-stone-700 truncate focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
                          />
                          <Button
                            onClick={handleCopyConsentUrl}
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0 border-stone-200 hover:bg-stone-50 text-stone-600"
                          >
                            {copied ? (
                              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springPresets.bouncy}>
                                <Check className="h-4 w-4 text-emerald-600" />
                              </motion.div>
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <p className="text-xs text-stone-500">
                        Once they grant consent, you can sign in normally.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Footer links */}
          <FadeIn animateOnMount delay={0.15}>
            <div className="mt-6 flex items-center justify-center gap-4 text-sm text-stone-400">
              <Link href="/" className="inline-flex items-center gap-1.5 hover:text-stone-600 transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to home
              </Link>
              <span className="text-stone-300">|</span>
              <Link
                href="/docs/docker"
                className="hover:text-stone-600 transition-colors"
              >
                Self-host guide
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-bg-deepest">
          <Loader2 className="h-8 w-8 animate-spin text-accent-cyan" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
