"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, ShieldCheck, Headphones, Sparkles } from "lucide-react";
import { T } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { springPresets } from "@/lib/animations/variants";

export function SupportedSolutionBanner() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      aria-labelledby="supported-solution-heading"
      className="relative w-full bg-bg-surface px-4 md:px-6 py-12 md:py-16"
    >
      <div className="container mx-auto max-w-6xl">
        <FadeIn>
          <div className="relative overflow-hidden rounded-2xl border border-overlay/10 bg-gradient-to-br from-bg-elevated via-bg-elevated to-bg-deepest shadow-soft">
            {/* Subtle glow accent */}
            <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent-cyan/10 blur-3xl" />

            <div className="relative flex flex-col items-start gap-5 p-5 md:flex-row md:items-center md:gap-6 md:p-6 lg:gap-8 lg:p-7">
              {/* Logo */}
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-white md:h-20 md:w-20">
                <Image
                  src="/robopack.png"
                  alt="RoboPack"
                  width={64}
                  height={64}
                  className="h-10 w-10 object-contain md:h-12 md:w-12"
                />
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1 space-y-2.5">
                <span className="inline-flex items-center gap-2 rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-3 py-1 text-xs font-medium text-accent-cyan-bright">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan-bright" />
                  <T id="supported_banner.badge">Looking for a supported solution?</T>
                </span>

                <h2
                  id="supported-solution-heading"
                  className="text-lg md:text-xl text-text-primary leading-relaxed"
                >
                  <T id="supported_banner.heading">
                    Need a supported, enterprise-ready solution with SLAs and maintenance? We recommend{" "}
                    <strong className="font-semibold text-text-primary">RoboPack</strong>.
                  </T>
                </h2>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-sm text-text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-accent-cyan-bright" />
                    <T id="supported_banner.feature_sla">Enterprise SLAs</T>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Headphones className="h-4 w-4 text-accent-cyan-bright" />
                    <T id="supported_banner.feature_support">Dedicated support</T>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-accent-cyan-bright" />
                    <T id="supported_banner.feature_managed">Managed deployments</T>
                  </span>
                </div>
              </div>

              {/* CTA */}
              <div className="shrink-0 lg:self-center">
                <motion.a
                  href="https://robopack.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-accent-cyan px-6 py-3 text-sm font-semibold text-white shadow-glow-cyan transition-all duration-300 hover:bg-accent-cyan-dim hover:shadow-glow-cyan-lg"
                  whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                  whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                  transition={springPresets.snappy}
                >
                  <T id="supported_banner.cta">Visit RoboPack</T>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </motion.a>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
