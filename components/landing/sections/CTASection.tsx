"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles, Server } from "lucide-react";
import Link from "next/link";
import { FadeIn } from "../animations/FadeIn";
import { GradientOrb } from "../ui/GradientOrb";

export function CTASection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="get-started"
      className="relative w-full py-24 md:py-32 overflow-hidden"
    >
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 100% 100% at 50% 100%, rgba(6, 182, 212, 0.1), transparent 50%)",
        }}
      />

      {/* Gradient orbs */}
      <GradientOrb
        color="cyan"
        size="xl"
        className="left-1/4 bottom-0"
        intensity="medium"
      />
      <GradientOrb
        color="violet"
        size="lg"
        className="right-1/4 bottom-1/4"
        intensity="low"
      />

      {/* Animated border */}
      <div className="absolute top-0 left-0 right-0 h-px">
        <motion.div
          className="h-full bg-gradient-to-r from-transparent via-accent-cyan to-transparent"
          animate={
            shouldReduceMotion
              ? {}
              : {
                  opacity: [0.3, 0.7, 0.3],
                }
          }
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>

      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        <div className="text-center space-y-8">
          <FadeIn>
            <div className="inline-flex items-center gap-2 text-accent-cyan mb-4">
              <Sparkles className="h-5 w-5" />
              <span className="font-mono text-sm uppercase tracking-wider">
                Get Started
              </span>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <h2 className="text-display-md text-white">
              Ready to Streamline Your App Deployment?
            </h2>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Start deploying applications from Winget to Intune in minutes.
              Free to use, open source, and enterprise-ready.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              {/* Primary CTA */}
              <Link
                href="/auth/signin"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-bg-deepest bg-accent-cyan rounded-xl hover:bg-accent-cyan-bright transition-all duration-300 shadow-lg shadow-accent-cyan/25 hover:shadow-accent-cyan/40 hover:scale-[1.02]"
              >
                Get Started Free
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>

              {/* Secondary CTA */}
              <Link
                href="/docs/getting-started"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-zinc-300 bg-zinc-800/50 border border-zinc-700 rounded-xl hover:bg-zinc-800 hover:border-zinc-600 hover:text-white transition-all duration-300"
              >
                <Server className="h-5 w-5" />
                Self-Host
              </Link>
            </div>
          </FadeIn>

          <FadeIn delay={0.4}>
            <div className="flex items-center justify-center gap-6 text-sm text-zinc-500 pt-4">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                No credit card required
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Open source
              </span>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
