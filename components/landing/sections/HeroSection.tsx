"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import Image from "next/image";
import { Github, ArrowRight, Star, Users, Upload, BookOpen, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Badge } from "../ui/Badge";
import { GradientOrb } from "../ui/GradientOrb";
import { DeploymentFeed } from "../ui/DeploymentFeed";
import { FadeIn } from "../animations/FadeIn";
import { TextReveal } from "../animations/TextReveal";
import { useGitHubStats } from "@/hooks/useGitHubStats";
import { useLandingStats } from "@/hooks/useLandingStats";
import { springPresets } from "@/lib/animations/variants";

const MotionLink = motion.create(Link);

export function HeroSection() {
  const { stars } = useGitHubStats();
  const { signinClicks, appsDeployed, appsSupported } = useLandingStats();
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const starsDisplay = stars.toLocaleString();
  const signinsDisplay = signinClicks.toLocaleString();
  const appsDeployedDisplay = appsDeployed.toLocaleString();
  const supportedAppsDisplay = appsSupported.toLocaleString();

  // 3B: Parallax for gradient orbs
  const { scrollY } = useScroll();
  const orbY1 = useTransform(scrollY, [0, 500], [0, -30]);
  const orbY2 = useTransform(scrollY, [0, 500], [0, -20]);

  return (
    <section ref={sectionRef} className="relative w-full min-h-[100dvh] flex items-center overflow-hidden">
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

      <div className="container px-4 md:px-6 mx-auto max-w-6xl py-16 md:py-24 relative z-10">
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
                Free & Open Source
              </Badge>
            </motion.div>

            {/* Headline - 1A: TextReveal with word-by-word blur effect */}
            <TextReveal
              as="h1"
              text={"From Winget to\nIntune\u00A0in\u00A0Minutes"}
              className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-text-primary tracking-tight"
              animateOnMount
              delay={0.05}
              staggerDelay={0.04}
            />

            {/* Subheadline with authoritative statement */}
            <FadeIn delay={0.1} animateOnMount duration={0.4} direction="up">
              <p className="max-w-lg text-lg md:text-xl text-text-secondary leading-relaxed">
                Search {supportedAppsDisplay}+ Winget packages, package automatically, and
                deploy to Microsoft Intune without scripting. Built for IT teams
                that want speed without hidden costs.
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
                    Start Free Deployment
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
                    Read the Docs
                  </MotionLink>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <Link
                    href="/#how-it-works"
                    className="text-text-muted hover:text-text-secondary transition-colors"
                  >
                    See How It Works
                  </Link>
                  <motion.a
                    href="https://github.com/ugurkocde/IntuneGet"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-text-muted hover:text-text-secondary transition-colors"
                    whileHover={shouldReduceMotion ? {} : { x: 2 }}
                    transition={springPresets.snappy}
                  >
                    <Github className="h-4 w-4" />
                    View on GitHub
                  </motion.a>
                  <Link
                    href="/docs/docker"
                    className="text-text-muted hover:text-text-secondary transition-colors"
                  >
                    Self-host with Docker
                  </Link>
                </div>
              </div>
            </FadeIn>

            {/* Trust strip */}
            <FadeIn delay={0.2} animateOnMount duration={0.4} direction="up">
              <div className="flex items-center gap-4 text-sm text-text-muted">
                <span className="flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-500" />
                  {starsDisplay} stars
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-accent-cyan" />
                  {signinsDisplay}+ active users
                </span>
                <span className="flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-emerald-500" />
                  {appsDeployedDisplay}+ apps uploaded
                </span>
              </div>
            </FadeIn>

            {/* Sponsor banner */}
            <FadeIn delay={0.25} animateOnMount duration={0.4} direction="up">
              <motion.a
                href="https://www.realmjoin.com"
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="block relative rounded-xl overflow-hidden max-w-lg group"
                whileHover={shouldReduceMotion ? {} : { scale: 1.01 }}
                whileTap={shouldReduceMotion ? {} : { scale: 0.995 }}
                transition={springPresets.snappy}
              >
                {/* Outer glow on hover */}
                <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-orange-500/20 via-orange-400/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                {/* Card surface */}
                <div className="relative rounded-xl bg-bg-elevated/80 backdrop-blur-sm border border-overlay/[0.08] group-hover:border-orange-500/20 transition-colors duration-300 p-4">
                  {/* Left accent bar */}
                  <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-gradient-to-b from-orange-400 to-orange-600" />

                  <div className="pl-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-orange-400/80">
                          Sponsor
                        </span>
                        <Image
                          src="/realmjoin-logo.png"
                          alt=""
                          width={18}
                          height={18}
                          className="rounded-[3px]"
                        />
                        <span className="text-sm font-bold text-text-primary group-hover:text-orange-300 transition-colors duration-300">
                          RealmJoin
                        </span>
                        <span className="hidden sm:inline text-xs text-text-muted">
                          by glueckkanja
                        </span>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0" />
                    </div>
                    <p className="text-[13px] text-text-secondary leading-relaxed">
                      IntuneGet is free and community-driven. When your team needs
                      enterprise app management, process automation, and dedicated
                      support, RealmJoin is the Intune companion we recommend.
                    </p>
                  </div>
                </div>
              </motion.a>
            </FadeIn>
          </div>

          {/* Right column: ProductShowcase */}
          <FadeIn delay={0.2} animateOnMount duration={0.5} direction="right">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border border-overlay/10 bg-bg-elevated/85 px-3 py-1 text-xs font-medium text-text-secondary">
                Live packaging simulation
              </div>
              <DeploymentFeed mode="heroCalm" />
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
