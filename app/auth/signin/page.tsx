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
import {
  getSafeInternalRedirect,
  rememberPostAuthRedirect,
} from '@/lib/auth/post-auth-redirect';

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
  const { isAuthenticated, signIn, signOut, getAccessToken } = useMicrosoftAuth();
  const { signinClicks, appsSupported } = useLandingStats();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isVerifyingConsent, setIsVerifyingConsent] = useState(false);
  const [verifyFailed, setVerifyFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConsentSectionOpen, setIsConsentSectionOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const callbackUrl = getSafeInternalRedirect(searchParams.get('callbackUrl'));
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

  // Run consent verification with a hard timeout so a hung token/popup
  // acquisition can never leave the user stuck on the loading animation.
  const runVerification = useCallback(() => {
    setVerifyFailed(false);
    setIsVerifyingConsent(true);

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Verification hung (commonly a blocked or backgrounded sign-in popup).
      // Surface a retry path instead of spinning forever.
      setIsVerifyingConsent(false);
      setVerifyFailed(true);
    }, 15000);

    verifyConsentStatus()
      .then((outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (outcome.kind === 'verified') {
          markOnboardingComplete();
          router.push(callbackUrl);
        } else if (outcome.kind === 'consent_missing') {
          clearOnboardingCache();
          rememberPostAuthRedirect(callbackUrl);
          router.push(`/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        } else {
          // Transient failure: don't wipe the cache and don't strand the user
          // on /onboarding. Send them to the dashboard, where the in-page
          // retry banner can re-verify against the live API.
          router.push(callbackUrl);
        }
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        setIsVerifyingConsent(false);
        setVerifyFailed(true);
      });
  }, [verifyConsentStatus, router, callbackUrl]);

  // Redirect based on ACTUAL consent status (server-verified, not localStorage)
  // This ensures users with revoked/incomplete consent are sent to onboarding
  useEffect(() => {
    if (isAuthenticated && !isVerifyingConsent && !verifyFailed) {
      runVerification();
    }
  }, [isAuthenticated, isVerifyingConsent, verifyFailed, runVerification]);

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

  // Verification hung or failed -- never leave the user on an endless animation.
  if (verifyFailed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-deepest px-4">
        <div className="w-full max-w-md rounded-2xl border border-overlay/[0.08] bg-bg-elevated/95 p-8 text-center shadow-soft-lg">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10">
            <AlertTriangle className="h-7 w-7 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-text-primary">
            <T>Sign-in is taking longer than expected</T>
          </h2>
          <p className="mt-2 text-sm text-text-muted">
            <T>We couldn&apos;t finish verifying your session. This can happen when a sign-in popup is blocked or closed before it completes.</T>
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button onClick={runVerification} size="lg" className="w-full">
              <T>Try again</T>
            </Button>
            <Button
              onClick={() => { void signOut(); }}
              variant="outline"
              size="lg"
              className="w-full border-overlay/15 text-text-secondary"
            >
              <T>Sign out and start over</T>
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
    <div className="relative flex min-h-screen bg-bg-deepest">
      {/* Mobile background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden lg:hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(var(--overlay) / 0.07) 1px, transparent 0)',
            backgroundSize: '22px 22px',
            opacity: 0.55,
          }}
        />
        <div
          className="absolute -top-24 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.22) 0%, transparent 68%)' }}
        />
        <div
          className="absolute bottom-[-180px] right-[-140px] h-[420px] w-[420px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(124, 58, 237, 0.16) 0%, transparent 70%)' }}
        />
      </div>

      {/* Left side - Branding */}
      <div className="relative hidden overflow-hidden border-r border-overlay/10 bg-bg-deepest lg:flex lg:w-[55%]">
        {/* Background layers */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(145deg, rgb(var(--bg-elevated) / 0.72) 0%, rgb(var(--bg-surface) / 0.58) 42%, rgb(var(--bg-deepest) / 0.9) 100%)',
          }}
        />
        <GridBackground variant="dots" opacity={0.78} className="absolute inset-0" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(120deg, rgb(var(--overlay) / 0.05) 0, transparent 1px)',
            backgroundSize: '96px 96px',
            opacity: 0.42,
          }}
        />

        {/* Decorative gradient band */}
        <div
          className="absolute left-[-12%] right-[-8%] top-[28%] h-72 -rotate-3 pointer-events-none"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(8, 145, 178, 0.13) 18%, rgba(124, 58, 237, 0.1) 52%, transparent 86%)',
          }}
        />
        <div
          className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
          style={{
            background: 'linear-gradient(to top, rgb(var(--bg-deepest) / 0.72), transparent)',
          }}
        />

        {/* Gradient orbs */}
        <GradientOrb
          color="cyan"
          size="xl"
          className="-left-20 top-[18%]"
          intensity="high"
        />
        <GradientOrb
          color="violet"
          size="lg"
          className="right-[6%] bottom-[16%]"
          intensity="medium"
        />
        <GradientOrb
          color="mixed"
          size="md"
          className="left-[32%] bottom-[8%]"
          intensity="medium"
        />

        {/* Content */}
        <div className="relative z-10 mx-auto flex max-w-[560px] flex-col justify-center px-12 xl:px-20">
          {/* Logo and title */}
          <FadeIn animateOnMount delay={0}>
            <div className="mb-7 flex items-center gap-4">
              <div className="relative">
                <div className="absolute -inset-3 rounded-2xl bg-accent-cyan/20 blur-2xl" />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 bg-gradient-to-br from-accent-cyan to-accent-violet shadow-glow-cyan">
                  <Package className="h-7 w-7 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-text-primary"><T>IntuneGet</T></h1>
                <p className="text-sm font-medium text-text-muted"><T>Winget for Intune</T></p>
              </div>
            </div>
          </FadeIn>

          {/* Main Headline */}
          <motion.h2
            className="mb-5 text-4xl font-extrabold leading-[1.08] tracking-tight xl:text-5xl"
            initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <span className="gradient-text-cyan"><T><Var>{appsSupported.toLocaleString()}</Var> Apps.</T></span>
            <br />
            <span className="text-text-primary"><T>One Click.</T></span>
          </motion.h2>

          <FadeIn animateOnMount delay={0.1}>
            <p className="mb-6 max-w-md text-lg leading-relaxed text-text-secondary">
              <T>Deploy Win32 applications to Microsoft Intune with ease.
              Search Winget, configure, and upload in minutes.</T>
            </p>
          </FadeIn>

          {/* Gradient separator line */}
          <div className="mb-5 flex w-full max-w-md items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-accent-cyan/45 via-accent-violet/30 to-transparent" />
            <div className="h-1.5 w-1.5 rounded-full bg-accent-cyan shadow-glow-cyan" />
            <div className="h-px w-16 bg-gradient-to-r from-accent-violet/35 to-transparent" />
          </div>

          {/* Trust stats */}
          <FadeIn animateOnMount delay={0.15}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted"><T>Trusted by IT admins</T></p>
            <div className="flex flex-wrap gap-3">
              <motion.div
                whileHover={shouldReduceMotion ? {} : { y: -4 }}
                transition={springPresets.snappy}
                className="group relative flex min-w-[176px] items-center gap-3 overflow-hidden rounded-xl border border-accent-cyan/20 bg-bg-elevated/75 p-3.5 shadow-soft-md backdrop-blur-md transition-colors hover:border-accent-cyan/35"
              >
                <div
                  className="absolute inset-y-0 left-0 w-1 bg-accent-cyan"
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ background: 'linear-gradient(135deg, rgba(8, 145, 178, 0.08), transparent 58%)' }}
                  aria-hidden="true"
                />
                <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-accent-cyan/20 bg-accent-cyan/10">
                  <Users className="h-5 w-5 text-accent-cyan" />
                </div>
                <div className="relative">
                  <p className="gradient-text-cyan text-2xl font-extrabold leading-none">
                    <CountUp end={signinClicks} suffix="+" duration={1.5} delay={0.3} />
                  </p>
                  <p className="mt-1 text-sm font-medium text-text-muted"><T>Admins</T></p>
                </div>
              </motion.div>
              <motion.div
                whileHover={shouldReduceMotion ? {} : { y: -4 }}
                transition={springPresets.snappy}
                className="group relative flex min-w-[176px] items-center gap-3 overflow-hidden rounded-xl border border-accent-violet/20 bg-bg-elevated/75 p-3.5 shadow-soft-md backdrop-blur-md transition-colors hover:border-accent-violet/35"
              >
                <div
                  className="absolute inset-y-0 left-0 w-1 bg-accent-violet"
                  aria-hidden="true"
                />
                <div
                  className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  style={{ background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.08), transparent 58%)' }}
                  aria-hidden="true"
                />
                <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-accent-violet/20 bg-accent-violet/10">
                  <Boxes className="h-5 w-5 text-accent-violet" />
                </div>
                <div className="relative">
                  <p className="gradient-text-violet text-2xl font-extrabold leading-none">
                    <CountUp end={appsSupported} suffix="+" duration={1.5} delay={0.4} />
                  </p>
                  <p className="mt-1 text-sm font-medium text-text-muted"><T>Apps available</T></p>
                </div>
              </motion.div>
            </div>
          </FadeIn>

          {/* Multi-tenant badge */}
          <FadeIn animateOnMount delay={0.2}>
            <div className="mt-5 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-bg-elevated/60 px-3 py-2 text-sm font-medium text-text-secondary shadow-soft backdrop-blur-md">
              <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.45)]" />
              <span><T>Multi-tenant support - works with any Entra ID tenant</T></span>
            </div>
          </FadeIn>
        </div>

        {/* Cyan glow accent along divider */}
        <div
          className="absolute top-0 right-0 bottom-0 w-px pointer-events-none"
          style={{
            background: 'linear-gradient(to bottom, transparent 8%, rgba(8, 145, 178, 0.42) 34%, rgba(124, 58, 237, 0.28) 58%, transparent 90%)',
          }}
        />
      </div>

      {/* Right side - Sign in form */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-8 sm:px-6 lg:px-12 lg:py-0 xl:px-20">
        {/* Right panel background texture */}
        <div className="absolute inset-0 pointer-events-none">
          <div
            className="absolute inset-0 lg:hidden"
            style={{
              background: 'linear-gradient(180deg, rgb(var(--bg-deepest) / 0.18), rgb(var(--bg-surface) / 0.38))',
            }}
          />
          <div
            className="absolute inset-0 hidden lg:block"
            style={{
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(var(--overlay) / 0.08) 1px, transparent 0)',
              backgroundSize: '24px 24px',
              opacity: 0.56,
            }}
          />
          <div
            className="absolute left-1/2 top-[44%] h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/3 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(8, 145, 178, 0.12) 0%, rgba(124, 58, 237, 0.06) 38%, transparent 68%)' }}
          />
          <div
            className="absolute bottom-[-260px] left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full lg:hidden"
            style={{ background: 'radial-gradient(circle, rgba(124, 58, 237, 0.14) 0%, transparent 68%)' }}
          />
        </div>

        <div className="relative z-10 w-full max-w-[420px]">
          {/* Mobile logo */}
          <FadeIn animateOnMount className="mb-7 flex flex-col items-center rounded-2xl border border-overlay/10 bg-bg-elevated/70 px-5 py-4 shadow-soft-md backdrop-blur-md lg:hidden">
            <div className="relative mb-4">
              <div className="absolute -inset-4 rounded-2xl bg-accent-cyan/25 blur-2xl" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/20 bg-gradient-to-br from-accent-cyan to-accent-violet shadow-glow-cyan">
                <Package className="h-8 w-8 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-text-primary"><T>IntuneGet</T></h1>
            <p className="text-sm font-medium text-text-muted"><T>Winget for Intune</T></p>
            {/* Mobile trust strip */}
            <div className="mt-4 flex w-full items-center justify-center gap-2 text-xs font-medium text-text-secondary">
              <span className="flex items-center gap-1.5 rounded-full border border-accent-cyan/20 bg-accent-cyan/10 px-2.5 py-1">
                <Users className="h-3 w-3 text-accent-cyan" />
                <T><Var>{signinClicks.toLocaleString()}</Var>+ admins</T>
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-accent-violet/20 bg-accent-violet/10 px-2.5 py-1">
                <Boxes className="h-3 w-3 text-accent-violet" />
                <T><Var>{appsSupported.toLocaleString()}</Var>+ apps</T>
              </span>
            </div>
          </FadeIn>

          {/* Sign in card */}
          <motion.div
            className="relative rounded-[1.35rem] bg-gradient-to-br from-accent-cyan/35 via-overlay/10 to-accent-violet/30 p-px"
            style={{
              boxShadow: '0 24px 70px rgba(8, 145, 178, 0.14), 0 10px 28px rgb(var(--overlay) / 0.08)',
            }}
            initial={shouldReduceMotion ? {} : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="relative overflow-hidden rounded-[1.28rem] border border-white/10 bg-bg-elevated/95 backdrop-blur-xl">
              <div
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ background: 'linear-gradient(90deg, rgba(8, 145, 178, 0.95), rgba(124, 58, 237, 0.85), rgba(8, 145, 178, 0.55))' }}
              />
              <div
                className="absolute inset-x-8 top-0 h-20 pointer-events-none"
                style={{ background: 'radial-gradient(ellipse at top, rgba(8, 145, 178, 0.16), transparent 70%)' }}
              />

              {/* Card content with intentional spacing */}
              <div className="relative px-8 pb-6 pt-10 sm:px-10 sm:pb-7 sm:pt-11">
                <div className="mb-8 text-center">
                  <h2 className="text-2xl font-extrabold tracking-tight text-text-primary"><T>Start Deploying</T></h2>
                  <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-text-muted">
                    <T>Sign in with your work account to get started</T>
                  </p>
                </div>

                {/* Error message */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={shouldReduceMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -8 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.3 }}
                      className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4"
                    >
                      <p className="text-center text-sm text-red-600"><T><Var>{error}</Var></T></p>
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
                <div className="mt-6 flex items-center justify-center gap-2 rounded-full border border-accent-cyan/15 bg-accent-cyan/5 px-3 py-2 text-xs font-medium text-text-secondary">
                  <Shield className="h-3.5 w-3.5 text-accent-cyan" />
                  <span><T>Protected by Microsoft Entra ID</T></span>
                </div>
              </div>

              {/* Consent section -- visually separated as footer zone */}
              <div className="relative border-t border-overlay/10 bg-gradient-to-br from-bg-surface/80 via-bg-elevated/70 to-accent-cyan/5 px-8 py-5 sm:px-10">
                <button
                  onClick={() => setIsConsentSectionOpen(!isConsentSectionOpen)}
                  className="mx-auto flex w-fit items-center justify-center gap-2 rounded-full border border-overlay/10 bg-bg-elevated/70 px-3.5 py-2 text-sm font-medium text-text-secondary shadow-soft transition-colors hover:border-accent-cyan/25 hover:bg-accent-cyan/5 hover:text-text-primary"
                >
                  <span><T>Need admin consent?</T></span>
                  <motion.div animate={{ rotate: isConsentSectionOpen ? 180 : 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}>
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
                      transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 space-y-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 shadow-soft">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
                          <div className="text-sm">
                            <p className="font-semibold text-amber-600"><T>Global Admin Required</T></p>
                            <p className="mt-1 text-amber-600/80">
                              <T>Only Global Administrators can grant the permissions IntuneGet needs.</T>
                            </p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-medium text-text-muted">
                            <T>Share this link with your Global Administrator:</T>
                          </label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              type="text"
                              readOnly
                              value={consentUrl}
                              className="flex-1 truncate rounded-lg border border-overlay/10 bg-bg-elevated px-3 py-2 text-sm text-text-secondary shadow-inner focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
                            />
                            <Button
                              onClick={handleCopyConsentUrl}
                              size="sm"
                              variant="outline"
                              className="flex-shrink-0 border-overlay/10 text-text-secondary hover:border-accent-cyan/25 hover:bg-accent-cyan/5"
                            >
                              {copied ? (
                                <motion.div
                                  initial={shouldReduceMotion ? { scale: 1 } : { scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={shouldReduceMotion ? { duration: 0 } : springPresets.bouncy}
                                >
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
            </div>
          </motion.div>

          {/* Footer links */}
          <FadeIn animateOnMount delay={0.15}>
            <div className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-text-muted">
              <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors hover:bg-overlay/[0.04] hover:text-text-primary">
                <ArrowLeft className="h-3.5 w-3.5" />
                <T>Back to home</T>
              </Link>
              <span className="h-4 w-px bg-overlay/15" />
              <Link
                href="/docs/docker"
                className="rounded-full px-3 py-1.5 transition-colors hover:bg-overlay/[0.04] hover:text-text-primary"
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
