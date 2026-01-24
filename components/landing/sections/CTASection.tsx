"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { GradientOrb } from "../ui/GradientOrb";
import { WaitlistFormDark } from "@/components/WaitlistFormDark";

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
              Be the First to Know
            </h2>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Join our waitlist to be notified when IntuneGet is ready. Get
              early access and start streamlining your Intune app deployment.
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="max-w-xl mx-auto">
              {/* Glowing border wrapper */}
              <div className="relative p-[1px] rounded-2xl bg-gradient-to-r from-accent-cyan/50 via-accent-violet/50 to-accent-cyan/50">
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-accent-cyan/20 via-accent-violet/20 to-accent-cyan/20 blur-xl" />
                <div className="relative bg-bg-surface rounded-2xl p-6 md:p-8">
                  <WaitlistFormDark />
                </div>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.4}>
            <div className="flex items-center justify-center gap-6 text-sm text-zinc-500 pt-4">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                No spam, ever
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Unsubscribe anytime
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Early access
              </span>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
