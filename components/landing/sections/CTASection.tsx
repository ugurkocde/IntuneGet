"use client";

import Image from "next/image";
import Link from "next/link";
import { T } from "gt-next";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  Globe2,
  Infinity as InfinityIcon,
  MonitorUp,
} from "lucide-react";
import { GithubMark } from "@/components/icons/brand-icons";
import { springPresets } from "@/lib/animations/variants";
import { type LandingStatValues } from "@/hooks/useLandingStats";
import { useSharedLandingStats } from "@/components/providers/LandingStatsProvider";
import { CountUp } from "../animations/CountUp";
import { FadeIn } from "../animations/FadeIn";

const MotionLink = motion.create(Link);

interface CTASectionProps {
  initialStats?: LandingStatValues;
}

const hostedBenefits = [
  { icon: Clock3, label: "5-minute setup" },
  { icon: Globe2, label: "Hosted in the EU" },
  { icon: InfinityIcon, label: "No per-device fees" },
];

export function CTASection({ initialStats }: CTASectionProps) {
  const shouldReduceMotion = useReducedMotion();
  const { appsDeployed } = useSharedLandingStats(initialStats);

  return (
    <section
      id="get-started"
      className="relative w-full overflow-hidden bg-bg-surface py-20 scroll-mt-20 md:py-28 md:scroll-mt-24"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_10%,rgba(0,174,239,0.09),transparent_38%)]" />
      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <FadeIn className="mx-auto mb-10 max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl lg:text-5xl">
            <T id="cta.heading">Use IntuneGet your way.</T>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-text-secondary md:text-xl">
            <T id="cta.subheading">
              Start with the hosted service, or run the same open-source
              platform in your own environment.
            </T>
          </p>
        </FadeIn>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.8fr)_minmax(300px,0.9fr)]">
          <FadeIn>
            <article className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-accent-cyan/20 bg-bg-elevated p-6 shadow-card md:p-8">
              <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-accent-cyan/[0.06] blur-3xl" />

              <div className="relative mb-7 flex items-center justify-between gap-4">
                <span className="inline-flex items-center rounded-full border border-status-success/25 bg-status-success/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-status-success">
                  <T id="cta.fastest-path">Fastest path</T>
                </span>
                <span className="hidden text-sm font-medium text-text-muted sm:inline">
                  intuneget.com
                </span>
              </div>

              <div className="relative grid flex-1 items-center gap-8 md:grid-cols-[0.8fr_1.4fr] md:gap-10">
                <div
                  className="mx-auto flex items-center gap-3 text-accent-cyan md:mx-0"
                  aria-hidden="true"
                >
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-accent-cyan/10">
                    <Globe2 className="h-11 w-11" strokeWidth={1.6} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan/35" />
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan/55" />
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan/80" />
                    <ArrowRight className="h-7 w-7" />
                  </div>
                  <MonitorUp className="h-20 w-20" strokeWidth={1.5} />
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-text-primary md:text-3xl">
                    <T id="cta.hosted-heading">Start deploying now</T>
                  </h3>
                  <p className="mt-3 max-w-xl leading-relaxed text-text-secondary">
                    <T id="cta.hosted-copy">
                      Sign in, select an app, review the settings, and begin the
                      upload.
                    </T>
                  </p>
                  <MotionLink
                    href="/auth/signin"
                    className="group mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent-cyan px-6 py-4 text-base font-semibold text-white shadow-glow-cyan transition-colors hover:bg-accent-cyan-dim sm:w-auto sm:min-w-72"
                    whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
                    transition={springPresets.snappy}
                  >
                    <T id="cta.primary">Start upload to Intune</T>
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </MotionLink>
                </div>
              </div>

              <ul className="relative mt-8 grid gap-3 border-t border-overlay/10 pt-6 sm:grid-cols-3">
                {hostedBenefits.map((benefit) => (
                  <li
                    key={benefit.label}
                    className="flex items-center gap-2.5 text-sm font-medium text-text-secondary"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-success/10 text-status-success">
                      <benefit.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <T>{benefit.label}</T>
                  </li>
                ))}
              </ul>
            </article>
          </FadeIn>

          <FadeIn delay={0.1}>
            <article className="flex h-full flex-col rounded-3xl border border-overlay/10 bg-bg-elevated p-6 shadow-card md:p-8">
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2.5">
                  <Image
                    src="/icons/Docker.DockerDesktop/icon-64.png"
                    alt="Docker"
                    width={52}
                    height={52}
                    className="h-12 w-12 object-contain"
                  />
                  <span className="text-lg font-bold text-[#2496ED]">
                    Docker
                  </span>
                </div>
                <span className="h-10 w-px bg-overlay/15" aria-hidden="true" />
                <div className="flex items-center gap-2.5 text-text-primary">
                  <GithubMark className="h-10 w-10" />
                  <span className="text-lg font-bold">GitHub</span>
                </div>
              </div>

              <div className="mt-10 flex-1">
                <h3 className="text-2xl font-bold text-text-primary md:text-3xl">
                  <T id="cta.self-host-heading">Run it yourself</T>
                </h3>
                <p className="mt-3 leading-relaxed text-text-secondary">
                  <T id="cta.self-host-copy">
                    Deploy with Docker and SQLite, with full control of your
                    environment.
                  </T>
                </p>
              </div>

              <div className="mt-8 space-y-4">
                <MotionLink
                  href="/docs/docker"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-accent-cyan/60 px-5 py-3.5 text-sm font-semibold text-accent-cyan transition-colors hover:bg-accent-cyan/5"
                  whileHover={shouldReduceMotion ? {} : { y: -1 }}
                  whileTap={shouldReduceMotion ? {} : { scale: 0.98 }}
                  transition={springPresets.snappy}
                >
                  <T id="cta.self-host-guide">View self-hosting guide</T>
                  <ArrowRight className="h-4 w-4" />
                </MotionLink>
                <a
                  href="https://github.com/ugurkocde/IntuneGet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
                >
                  <T id="cta.browse-source">Browse the source</T>
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </article>
          </FadeIn>
        </div>

        <FadeIn delay={0.2}>
          <div className="mt-5 flex flex-col gap-6 rounded-2xl border border-overlay/10 bg-bg-elevated px-5 py-5 shadow-soft lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <a
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 text-text-primary transition-colors hover:text-accent-cyan"
            >
              <GithubMark className="h-8 w-8 shrink-0 text-status-success" />
              <span className="font-medium">
                <T id="cta.license">Open source under AGPL-3.0</T>
              </span>
            </a>

            {appsDeployed > 0 && (
              <p className="flex items-baseline gap-2">
                <span className="text-2xl font-bold leading-none text-text-primary tabular-nums">
                  <CountUp end={appsDeployed} />
                </span>
                <span className="text-sm text-text-muted">
                  <T>apps deployed to Intune tenants so far</T>
                </span>
              </p>
            )}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
