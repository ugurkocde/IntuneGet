'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Shield, Loader2, Package, ChevronDown, Copy, Check, AlertTriangle, Users, Boxes, ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
import { T, Var } from "gt-next";
import { VerificationSceneFallback } from '@/components/auth/verification-scene/VerificationSceneFallback';
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

const VerificationScene = dynamic(
  () => import('@/components/auth/verification-scene/VerificationScene').then(m => m.VerificationScene),
  { ssr: false, loading: () => <VerificationSceneFallback /> }
);

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
   * Verify consent status via API (server-side check). Returns the structured
   * result so the caller can distinguish a real consent gap (route to
   * onboarding, wipe cache) from a transient failure (keep cache, retry on
   * the dashboard).
   */
  type VerifyOutcome =
    | { kind: 'verified' }
    | { kind: 'consent_missing' }
    | { kind: 'transient' };

  const verifyConsentStatus = useCallback(async (): Promise<VerifyOutcome> => {
    try {
      const token = await getAccessToken();
      if (!token) return { kind: 'transient' };

      const response = await fetch('/api/auth/verify-consent', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) return { kind: 'transient' };

      const result = await response.json();
      if (result.verified === true) return { kind: 'verified' };

      // Only treat explicit consent-side failures as a reason to wipe the
      // cache and route to onboarding. Network/propagation/missing-credentials
      // are transient and must not invalidate a known-good local cache.
      if (
        result.error === 'consent_not_granted' ||
        result.error === 'insufficient_intune_permissions'
      ) {
        return { kind: 'consent_missing' };
      }
      return { kind: 'transient' };
    } catch {
      return { kind: 'transient' };
    }
  }, [getAccessToken]);

  // Redirect based on ACTUAL consent status (server-verified, not localStorage)
  // This ensures users with revoked/incomplete consent are sent to onboarding
  useEffect(() => {
    if (isAuthenticated && !isVerifyingConsent) {
      setIsVerifyingConsent(true);

      verifyConsentStatus().then((outcome) => {
        if (outcome.kind === 'verified') {
          markOnboardingComplete();
          router.push(callbackUrl);
        } else if (outcome.kind === 'consent_missing') {
          clearOnboardingCache();
          router.push('/onboarding');
        } else {
          // Transient failure: don't wipe the cache and don't strand the user
          // on /onboarding. Send them to the dashboard, where the in-page
          // retry banner can re-verify against the live API.
          router.push(callbackUrl);
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
    const statusText = isVerifyingConsent ? 'Verifying permissions...' : 'Redirecting to your dashboard...';
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-deepest">
        {shouldReduceMotion ? (
          <VerificationSceneFallback statusText={statusText} />
        ) : (
          <VerificationScene statusText={statusText} />
        )}
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
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden border-r border-overlay/[0.05]">
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
                <h1 className="text-2xl font-bold text-text-primary"><T>IntuneGet</T></h1>
                <p className="text-text-muted text-sm"><T>Winget for Intune</T></p>
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
            <span className="gradient-text-cyan"><T>10,000 Apps.</T></span>
            <br />
            <span className="text-text-primary"><T>One Click.</T></span>
          </motion.h2>

          <FadeIn animateOnMount delay={0.1}>
            <p className="text-lg text-text-secondary mb-6 max-w-md leading-relaxed">
              <T>Deploy Win32 applications to Microsoft Intune with ease.
              Search Winget, configure, and upload in minutes.</T>
            </p>
          </FadeIn>

          {/* Gradient separator line */}
          <div className="h-px w-3/4 bg-gradient-to-r from-transparent via-accent-cyan/30 to-transparent mb-5" />

          {/* Trust stats */}
          <FadeIn animateOnMount delay={0.15}>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3"><T>Trusted by IT admins</T></p>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-elevated/60 border border-overlay/[0.04] shadow-soft">
                <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
                  <Users className="w-5 h-5 text-accent-cyan" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary">
                    <CountUp end={signinClicks} suffix="+" duration={1.5} delay={0.3} />
                  </p>
                  <p className="text-sm text-text-muted"><T>Admins</T></p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-bg-elevated/60 border border-overlay/[0.04] shadow-soft">
                <div className="w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
                  <Boxes className="w-5 h-5 text-accent-violet" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-text-primary">
                    <CountUp end={appsSupported} suffix="+" duration={1.5} delay={0.4} />
                  </p>
                  <p className="text-sm text-text-muted"><T>Apps available</T></p>
                </div>
              </div>
            </div>
          </FadeIn>

          {/* Multi-tenant badge */}
          <FadeIn animateOnMount delay={0.2}>
            <div className="mt-5 flex items-center gap-2 text-sm text-text-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span><T>Multi-tenant support - works with any Entra ID tenant</T></span>
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
            <h1 className="text-2xl font-bold text-text-primary"><T>IntuneGet</T></h1>
            <p className="text-text-muted text-sm"><T>Winget for Intune</T></p>
            {/* Mobile trust strip */}
            <div className="flex items-center gap-4 text-xs text-text-muted mt-2">
              <span className="flex items-center gap-1.5">
                <Users className="w-3 h-3 text-accent-cyan" />
                <T><Var>{signinClicks.toLocaleString()}</Var>+ admins</T>
              </span>
              <span className="w-px h-3 bg-overlay/20" />
              <span className="flex items-center gap-1.5">
                <Boxes className="w-3 h-3 text-accent-violet" />
                <T><Var>{appsSupported.toLocaleString()}</Var>+ apps</T>
              </span>
            </div>
          </FadeIn>

          {/* Sign in card */}
          <motion.div
            className="relative bg-bg-elevated/95 backdrop-blur-sm border border-overlay/[0.08] rounded-2xl shadow-soft-lg overflow-hidden"
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            {/* Top accent line */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/50 to-transparent" />

            {/* Card content with intentional spacing */}
            <div className="px-8 pt-10 pb-6 sm:px-10 sm:pt-12 sm:pb-8">
              <div className="text-center mb-10">
                <h2 className="text-2xl font-bold tracking-tight text-text-primary"><T>Start Deploying</T></h2>
                <p className="text-text-muted mt-2">
                  <T>Sign in with your work account to get started</T>
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
                    className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl"
                  >
                    <p className="text-red-600 text-sm text-center"><T><Var>{error}</Var></T></p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Sign in button -- Microsoft brand spec (light theme variant) */}
              <motion.div
                whileHover={shouldReduceMotion ? {} : { scale: 1.01 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                transition={springPresets.snappy}
              >
                <Button
                  onClick={handleSignIn}
                  disabled={isSigningIn}
                  size="lg"
                  className="w-full h-[41px] text-sm font-semibold gap-3 rounded-[2px] bg-white hover:bg-[#f5f5f5] text-[#5E5E5E] border border-[#8C8C8C] hover:border-[#5E5E5E] transition-colors duration-150"
                >
                  {isSigningIn ? (
                    <>
                      <Loader2 className="h-[19px] w-[19px] animate-spin" />
                      <T>Signing in...</T>
                    </>
                  ) : (
                    <>
                      <MicrosoftLogo className="h-[19px] w-[19px]" />
                      <T>Sign in with Microsoft</T>
                    </>
                  )}
                </Button>
              </motion.div>

              {/* Trust badge */}
              <div className="flex items-center justify-center gap-2 text-xs text-text-muted mt-6">
                <Shield className="h-3.5 w-3.5 text-accent-cyan/70" />
                <span><T>Protected by Microsoft Entra ID</T></span>
              </div>
            </div>

            {/* Consent section -- visually separated as footer zone */}
            <div className="border-t border-overlay/10 bg-bg-surface/50 px-8 py-5 sm:px-10">
              <button
                onClick={() => setIsConsentSectionOpen(!isConsentSectionOpen)}
                className="w-full flex items-center justify-center gap-2 text-sm text-text-muted hover:text-text-secondary transition-colors"
              >
                <span><T>Need admin consent?</T></span>
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
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 space-y-4 mt-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="text-amber-600 font-medium"><T>Global Admin Required</T></p>
                          <p className="text-amber-600/80 mt-1">
                            <T>Only Global Administrators can grant the permissions IntuneGet needs.</T>
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-text-muted font-medium">
                          <T>Share this link with your Global Administrator:</T>
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            readOnly
                            value={consentUrl}
                            className="flex-1 px-3 py-2 bg-bg-elevated border border-overlay/10 rounded-lg text-sm text-text-secondary truncate focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
                          />
                          <Button
                            onClick={handleCopyConsentUrl}
                            size="sm"
                            variant="outline"
                            className="flex-shrink-0 border-overlay/10 hover:bg-overlay/[0.04] text-text-secondary"
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

                      <p className="text-xs text-text-muted">
                        <T>Once they grant consent, you can sign in normally.</T>
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>

          {/* Footer links */}
          <FadeIn animateOnMount delay={0.15}>
            <div className="mt-6 flex items-center justify-center gap-4 text-sm text-text-muted">
              <Link href="/" className="inline-flex items-center gap-1.5 hover:text-text-secondary transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" />
                <T>Back to home</T>
              </Link>
              <span className="text-overlay/20">|</span>
              <Link
                href="/docs/docker"
                className="hover:text-text-secondary transition-colors"
              >
                <T>Self-host guide</T>
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
