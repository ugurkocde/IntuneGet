"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";
import { T } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { GitHubStatsBar } from "../ui/GitHubStatsBar";
import { springPresets } from "@/lib/animations/variants";
import type { GitHubStatValues } from "@/hooks/useGitHubStats";

const MotionLink = motion.create(Link);

interface CTASectionProps {
  initialGitHubStats?: GitHubStatValues;
}

export function CTASection({ initialGitHubStats }: CTASectionProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="get-started"
      className="relative w-full py-20 md:py-28 scroll-mt-20 md:scroll-mt-24 overflow-hidden bg-bg-surface"
    >
      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        <div className="text-center space-y-8">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              <T id="cta.badge">Get Started</T>
            </span>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary">
              <T id="cta.heading">Ready to Deploy Winget Apps to Intune in Minutes?</T>
            </h2>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed">
              <T id="cta.subheading">Set up in under 5 minutes and deploy as many apps as you need. Completely free, no limits.</T>
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              {/* Primary CTA - Accent cyan */}
              <MotionLink
                href="/auth/signin"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all duration-300 shadow-glow-cyan hover:shadow-glow-cyan-lg"
                whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                transition={springPresets.snappy}
              >
                <T id="cta.primary">Start Deploying Free</T>
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </MotionLink>
            </div>
          </FadeIn>

          {/* Tertiary link */}
          <FadeIn delay={0.35}>
            <div className="flex items-center justify-center gap-6 pt-2">
              <Link
                href="/docs"
                className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors"
              >
                <BookOpen className="h-4 w-4" />
                <T id="cta.docs">Read the Documentation</T>
              </Link>
            </div>
            <GitHubStatsBar className="pt-4" initialStats={initialGitHubStats} />
          </FadeIn>

        </div>
      </div>
    </section>
  );
}
