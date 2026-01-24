"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Github, Shield, Package, ArrowRight, Server } from "lucide-react";
import Link from "next/link";
import { Badge } from "../ui/Badge";
import { GradientOrb } from "../ui/GradientOrb";
import { GridBackground } from "../ui/GridBackground";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { TextReveal } from "../animations/TextReveal";
import { CountUp } from "../animations/CountUp";

export function HeroSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative w-full min-h-screen flex items-center justify-center py-20 md:py-32 overflow-hidden">
      {/* Background layers */}
      <GridBackground variant="dots" opacity={0.3} className="absolute inset-0" />

      {/* Gradient orbs */}
      <GradientOrb
        color="cyan"
        size="xl"
        className="left-1/4 top-1/4 -translate-x-1/2 -translate-y-1/2"
        intensity="medium"
      />
      <GradientOrb
        color="violet"
        size="lg"
        className="right-1/4 bottom-1/4 translate-x-1/2 translate-y-1/2"
        intensity="low"
        animate={!shouldReduceMotion}
      />
      <GradientOrb
        color="mixed"
        size="md"
        className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        intensity="low"
      />

      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(6, 182, 212, 0.15), transparent)",
        }}
      />

      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        <div className="flex flex-col items-center space-y-8 md:space-y-12 text-center">
          {/* Badges */}
          <StaggerContainer
            className="flex flex-wrap items-center justify-center gap-3"
            staggerDelay={0.1}
          >
            <StaggerItem>
              <Badge icon={<Github className="h-3.5 w-3.5" />} variant="success">
                Open Source
              </Badge>
            </StaggerItem>
            <StaggerItem>
              <Badge icon={<Shield className="h-3.5 w-3.5" />} variant="violet">
                Enterprise Ready
              </Badge>
            </StaggerItem>
          </StaggerContainer>

          {/* Headline */}
          <div className="space-y-4 md:space-y-6 max-w-4xl">
            <FadeIn delay={0.3}>
              <h1 className="text-display-lg md:text-5xl lg:text-6xl xl:text-7xl">
                <span className="block text-white mb-2">Simplify Your</span>
                <TextReveal
                  text="Intune App Deployment"
                  className="gradient-text-cyan"
                  delay={0.5}
                />
              </h1>
            </FadeIn>

            <FadeIn delay={0.5}>
              <p className="mx-auto max-w-2xl text-lg md:text-xl text-zinc-400 leading-relaxed">
                Package and upload your applications to Intune with{" "}
                <span className="text-accent-cyan font-medium">
                  Winget integration
                </span>
                . Streamline your workflow with automated deployment and
                enterprise-grade security.
              </p>
            </FadeIn>
          </div>

          {/* CTA Buttons */}
          <FadeIn delay={0.7} className="w-full max-w-2xl">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              {/* Primary CTA - Use Web Portal */}
              <Link
                href="/auth/signin"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-accent-cyan to-accent-cyan/80 rounded-xl hover:from-accent-cyan/90 hover:to-accent-cyan/70 transition-all duration-300 shadow-lg shadow-accent-cyan/25 hover:shadow-accent-cyan/40 hover:scale-[1.02]"
              >
                Get Started Free
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>

              {/* Secondary CTA - Self-Host */}
              <Link
                href="/docs/getting-started"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-zinc-300 bg-zinc-800/50 border border-zinc-700 rounded-xl hover:bg-zinc-800 hover:border-zinc-600 hover:text-white transition-all duration-300"
              >
                <Server className="h-5 w-5" />
                Self-Host
              </Link>
            </div>
            <p className="mt-4 text-sm text-zinc-500">
              No credit card required. Deploy to your own infrastructure or use our hosted service.
            </p>
          </FadeIn>

          {/* Stats */}
          <FadeIn delay={0.9}>
            <div className="flex flex-wrap items-center justify-center gap-8 pt-8">
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Github className="h-4 w-4 text-accent-cyan" />
                <span className="text-white font-medium">100% Open Source</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Package className="h-4 w-4 text-accent-cyan" />
                <span>
                  <CountUp end={10000} suffix="+" className="text-white font-medium" />{" "}
                  apps supported
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <Shield className="h-4 w-4 text-accent-cyan" />
                <span className="text-white font-medium">Enterprise security</span>
              </div>
            </div>
          </FadeIn>

          {/* Scroll indicator */}
          <motion.div
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.5 }}
          >
            <motion.div
              className="w-6 h-10 rounded-full border-2 border-zinc-700 flex items-start justify-center p-1"
              animate={
                shouldReduceMotion
                  ? {}
                  : {
                      borderColor: [
                        "rgba(113, 113, 122, 1)",
                        "rgba(6, 182, 212, 0.5)",
                        "rgba(113, 113, 122, 1)",
                      ],
                    }
              }
              transition={{ duration: 2, repeat: Infinity }}
            >
              <motion.div
                className="w-1.5 h-3 bg-zinc-500 rounded-full"
                animate={
                  shouldReduceMotion
                    ? {}
                    : {
                        y: [0, 12, 0],
                        backgroundColor: [
                          "rgba(113, 113, 122, 1)",
                          "rgba(6, 182, 212, 1)",
                          "rgba(113, 113, 122, 1)",
                        ],
                      }
                }
                transition={{ duration: 2, repeat: Infinity }}
              />
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
