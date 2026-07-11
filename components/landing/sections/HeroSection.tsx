"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, Package, Scale, Upload, BookOpen } from "lucide-react";
import { Github } from "@/components/icons/brand-icons";
import Link from "next/link";
import { T, Var, useGT, useLocale } from "gt-next";
import { Badge } from "../ui/Badge";
import { GradientOrb } from "../ui/GradientOrb";
import { DeploymentFeed } from "../ui/DeploymentFeed";
import { FadeIn } from "../animations/FadeIn";
import { TextReveal } from "../animations/TextReveal";
import { useLandingStats, type LandingStatValues } from "@/hooks/useLandingStats";
import { springPresets } from "@/lib/animations/variants";

const MotionLink = motion.create(Link);

interface HeroSectionProps {
  initialStats?: LandingStatValues;
  // Accepted for page.tsx plumbing compatibility; the hero no longer renders
  // a star count (the header shows the live count instead).
  initialGitHubStars?: number;
}

export function HeroSection({ initialStats }: HeroSectionProps) {
  const t = useGT();
  // gt-next locale is identical on server and client; the browser's implicit
  // locale is not, and a bare toLocaleString() breaks hydration for non-en users.
  // An empty locale string would make toLocaleString throw a RangeError.
  const localeTag = useLocale() || undefined;
  const { appsDeployed, appsSupported } = useLandingStats(initialStats);
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const appsDeployedDisplay = appsDeployed.toLocaleString(localeTag);
  const supportedAppsDisplay = appsSupported.toLocaleString(localeTag);

  // 3B: Parallax for gradient orbs
  const { scrollY } = useScroll();
  const orbY1 = useTransform(scrollY, [0, 500], [0, -30]);
  const orbY2 = useTransform(scrollY, [0, 500], [0, -20]);

  return (
    <section ref={sectionRef} className="relative w-full min-h-0 md:min-h-[92dvh] flex items-center overflow-hidden">
      {/* Background gradient orbs with parallax */}
      <motion.div style={{ y: shouldReduceMotion ? 0 : orbY1 }}>
        <GradientOrb
          color="cyan"
          size="xl"
          intensity="low"
          className="top-0 right-0 -translate-y-1/4 translate-x-1/4"
        />
      </motion.div>
      <motion.div style={{ y: shouldReduceMotion ? 0 : orbY2 }}>
        <GradientOrb
          color="violet"
          size="xl"
          intensity="low"
          className="bottom-0 left-0 translate-y-1/4 -translate-x-1/4"
        />
      </motion.div>

      <div className="container px-4 md:px-6 mx-auto max-w-6xl pt-28 pb-14 md:pt-28 md:pb-16 relative z-10">
        <div className="grid gap-8 items-center md:grid-cols-[0.95fr_1.05fr] lg:gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Left column: text content */}
          <div className="flex flex-col items-center text-center md:items-start md:text-left space-y-5">
            {/* Badge - 1B: Spring-based entrance */}
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -15, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={shouldReduceMotion ? { duration: 0 } : springPresets.bouncy}
            >
              <Badge icon={<Github className="h-4 w-4" />} variant="dark">
                <T id="hero.badge">Free & Open Source</T>
              </Badge>
            </motion.div>

            {/* Headline - 1A: TextReveal with word-by-word blur effect */}
            <TextReveal
              as="h1"
              text={t("From Winget to\nIntune\u00A0in\u00A0Minutes")}
              className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-text-primary tracking-tight"
              animateOnMount
              delay={0.05}
              staggerDelay={0.04}
            />

            {/* Subheadline with authoritative statement */}
            <FadeIn delay={0.1} animateOnMount duration={0.4} direction="up">
              <p className="max-w-lg text-lg md:text-xl text-text-secondary leading-relaxed">
                {appsSupported > 0 ? (
                  <T id="hero.subheadline">
                    Search <Var>{supportedAppsDisplay}</Var>+ Winget packages, package automatically, and
                    deploy to Microsoft Intune without scripting. No per-device
                    licensing, no lock-in - free and open source.
                  </T>
                ) : (
                  <T id="hero.subheadline.nocount">
                    Search the full Winget catalog, package automatically, and
                    deploy to Microsoft Intune without scripting. No per-device
                    licensing, no lock-in - free and open source.
                  </T>
                )}
              </p>
            </FadeIn>

            {/* CTA buttons - 1C: whileTap feedback */}
            <FadeIn delay={0.15} animateOnMount duration={0.4} direction="up">
              <div className="flex flex-col items-center md:items-start gap-4 pt-2">
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3">
                  <MotionLink
                    href="/auth/signin"
                    className="group relative inline-flex items-center justify-center gap-2.5 px-8 py-4 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all duration-300 shadow-glow-cyan hover:shadow-glow-cyan-lg"
                    whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                    transition={springPresets.snappy}
                  >
                    <T id="hero.cta.deploy">Start Deploying Free</T>
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </MotionLink>
                  <MotionLink
                    href="/docs"
                    className="inline-flex items-center justify-center gap-2 px-6 py-4 text-base font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:border-overlay/15 hover:bg-overlay/[0.04] transition-all duration-300"
                    whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                    transition={springPresets.snappy}
                  >
                    <BookOpen className="h-5 w-5" />
                    <T id="hero.cta.docs">Read the Docs</T>
                  </MotionLink>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <Link
                    href="/docs/docker"
                    className="text-text-muted hover:text-text-secondary transition-colors"
                  >
                    <T id="hero.link.docker">Self-host with Docker</T>
                  </Link>
                  <Link
                    href="/apps"
                    className="text-text-muted hover:text-text-secondary transition-colors"
                  >
                    <T id="hero.link.catalog">Browse the catalog</T>
                  </Link>
                </div>
              </div>
            </FadeIn>

            {/* Trust strip */}
            <FadeIn delay={0.2} animateOnMount duration={0.4} direction="up">
              <div className="flex flex-wrap items-center gap-4 text-sm text-text-muted">
                {appsSupported > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-accent-cyan" />
                    <T id="hero.stats.catalog"><Var>{supportedAppsDisplay}</Var>+ apps available</T>
                  </span>
                )}
                {appsDeployed > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Upload className="w-3.5 h-3.5 text-emerald-500" />
                    <T id="hero.stats.deployed"><Var>{appsDeployedDisplay}</Var>+ apps deployed</T>
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-amber-500" />
                  <T id="hero.stats.license">Open source, AGPL-3.0</T>
                </span>
              </div>
            </FadeIn>

          </div>

          {/* Right column: ProductShowcase */}
          <FadeIn delay={0.2} animateOnMount duration={0.5} direction="right">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-overlay/10 bg-bg-elevated/85 px-3 py-1 text-xs font-medium text-text-secondary">
                <T id="hero.simulation">Live packaging simulation</T>
              </div>
              <DeploymentFeed mode="heroCalm" />
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
