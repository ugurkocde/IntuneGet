"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Github, Star, Shield, Clock, Download } from "lucide-react";
import Link from "next/link";
import { FadeIn } from "../animations/FadeIn";
import { GitHubStatsBar } from "../ui/GitHubStatsBar";
import { springPresets } from "@/lib/animations/variants";

const MotionLink = motion.create(Link);

export function CTASection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="get-started"
      className="relative w-full py-24 md:py-32 overflow-hidden bg-stone-50"
    >
      {/* Top border */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-stone-300 to-transparent" />

      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        <div className="text-center space-y-8">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              Get Started
            </span>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900">
              Ready to Stop Wasting Fridays on App Packaging?
            </h2>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="text-xl text-stone-600 max-w-2xl mx-auto leading-relaxed">
              Set up in under 5 minutes and deploy as many apps as you need.
              Completely free, no limits.
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
                Start Deploying — It's Free
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </MotionLink>

              {/* Secondary CTA - GitHub */}
              <motion.a
                href="https://github.com/ugurkocde/IntuneGet"
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-stone-700 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-all duration-300 shadow-soft"
                whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                transition={springPresets.snappy}
              >
                <Github className="h-5 w-5" />
                Star on GitHub
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              </motion.a>
            </div>
          </FadeIn>

          {/* GitHub community stats */}
          <FadeIn delay={0.35}>
            <GitHubStatsBar className="pt-4" />
          </FadeIn>

          {/* Risk reversal guarantees */}
          <FadeIn delay={0.4}>
            <div className="mt-8 pt-8 border-t border-stone-200/60">
              <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-stone-200/60">
                  <Clock className="w-5 h-5 text-accent-cyan flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-stone-900">5-Minute Setup</div>
                    <div className="text-xs text-stone-500">Or we help you debug</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-stone-200/60">
                  <Download className="w-5 h-5 text-accent-cyan flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-stone-900">No Lock-In</div>
                    <div className="text-xs text-stone-500">Export anytime</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-stone-200/60">
                  <Shield className="w-5 h-5 text-accent-cyan flex-shrink-0" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-stone-900">Zero Surprise Bills</div>
                    <div className="text-xs text-stone-500">Free forever</div>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
