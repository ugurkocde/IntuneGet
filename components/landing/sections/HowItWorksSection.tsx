"use client";

import { motion, useReducedMotion } from "framer-motion";
import { T } from "gt-next";
import {
  ArrowDown,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  MonitorSmartphone,
  Search,
  Settings2,
  Tag,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { FadeIn } from "../animations/FadeIn";

const settings = [
  { label: "Version", value: "Latest", icon: Tag },
  { label: "Architecture", value: "x64", icon: Settings2 },
  { label: "Install behavior", value: "System", icon: MonitorSmartphone },
  { label: "Assignments", value: "Optional", icon: CheckCircle2 },
];

const proofPoints = [
  {
    title: "Exact catalog ID",
    description: "The app you select is the app we open after sign-in.",
    icon: Search,
  },
  {
    title: "Settings before upload",
    description: "Review defaults or configure advanced deployment options.",
    icon: Settings2,
  },
  {
    title: "Track every deployment",
    description: "Follow packaging and upload progress from one place.",
    icon: BarChart3,
  },
];

function FlowConnector() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <div aria-hidden="true">
      <div className="absolute left-1/2 top-full flex h-12 -translate-x-1/2 items-center justify-center lg:hidden">
        <ArrowDown className="h-5 w-5 text-accent-cyan" />
      </div>
      <div className="absolute left-full top-1/2 hidden w-8 -translate-y-1/2 items-center lg:flex xl:w-12">
        <motion.div
          className="h-px flex-1 origin-left bg-accent-cyan"
          initial={shouldReduceMotion ? false : { scaleX: 0, opacity: 0 }}
          whileInView={
            shouldReduceMotion ? undefined : { scaleX: 1, opacity: 1 }
          }
          viewport={{ once: true, amount: 0.8 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        />
        <ArrowRight className="-ml-1 h-5 w-5 shrink-0 text-accent-cyan" />
      </div>
    </div>
  );
}

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="relative w-full scroll-mt-20 overflow-hidden border-t border-overlay/[0.06] bg-bg-elevated py-20 md:scroll-mt-24 md:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_50%_0%,var(--accent-cyan)_0%,transparent_68%)] opacity-[0.035]"
      />

      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-4xl text-center">
          <FadeIn>
            <span className="mb-4 inline-block font-mono text-xs uppercase tracking-[0.18em] text-accent-cyan">
              <T>After you search</T>
            </span>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h2 className="text-balance text-3xl font-bold tracking-tight text-text-primary md:text-4xl lg:text-5xl">
              <T>One selection. One review. One upload.</T>
            </h2>
          </FadeIn>
          <FadeIn delay={0.16}>
            <p className="mx-auto mt-5 max-w-3xl text-pretty text-base leading-relaxed text-text-secondary md:text-lg">
              <T>
                Choose a supported catalog app, review the deployment settings,
                then send it to your Microsoft Intune tenant.
              </T>
            </p>
          </FadeIn>
        </div>

        <FadeIn delay={0.22}>
          <ol
            aria-label="IntuneGet deployment workflow"
            className="relative mx-auto mt-12 grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.12fr_0.9fr] lg:items-center lg:gap-8 xl:gap-12"
          >
            <li className="relative">
              <article className="rounded-2xl border border-overlay/10 bg-bg-elevated p-5 shadow-card md:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
                    <T>Selected app</T>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <T>Verified</T>
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center">
                    <Image
                      src="/icons/7zip.7zip/icon-64.png"
                      alt=""
                      width={56}
                      height={56}
                      className="h-14 w-14 object-contain"
                    />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className="text-xl font-semibold text-text-primary"
                      translate="no"
                    >
                      7-Zip
                    </h3>
                    <p
                      className="mt-1 truncate font-mono text-sm text-text-secondary"
                      translate="no"
                    >
                      7zip.7zip
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex items-center gap-2 border-t border-overlay/10 pt-4 text-sm text-text-secondary">
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-accent-cyan"
                    aria-hidden="true"
                  />
                  <T>Matched by its exact catalog ID</T>
                </div>
              </article>
              <FlowConnector />
            </li>

            <li className="relative">
              <article className="overflow-hidden rounded-2xl border border-accent-cyan/20 bg-bg-elevated shadow-card">
                <div className="flex items-center justify-between border-b border-overlay/10 px-5 py-4 md:px-6">
                  <div>
                    <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
                      <T>Review</T>
                    </span>
                    <h3 className="mt-1 text-lg font-semibold text-text-primary">
                      <T>Deployment settings</T>
                    </h3>
                  </div>
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
                    <Settings2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                </div>

                <dl className="divide-y divide-overlay/10 px-5 md:px-6">
                  {settings.map(({ label, value, icon: Icon }) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 py-3.5"
                    >
                      <dt className="flex items-center gap-2.5 text-sm text-text-secondary">
                        <Icon
                          className="h-4 w-4 text-text-muted"
                          aria-hidden="true"
                        />
                        <T>{label}</T>
                      </dt>
                      <dd className="text-sm font-medium text-text-primary">
                        <T>{value}</T>
                      </dd>
                    </div>
                  ))}
                </dl>

                <div className="border-t border-overlay/10 bg-accent-cyan/[0.045] px-5 py-3.5 text-sm text-text-secondary md:px-6">
                  <T>Advanced settings remain available before upload.</T>
                </div>
              </article>
              <FlowConnector />
            </li>

            <li className="relative">
              <article className="rounded-2xl border border-overlay/10 bg-bg-elevated p-5 shadow-card md:p-6">
                <span className="font-mono text-xs uppercase tracking-wider text-text-muted">
                  <T>Destination</T>
                </span>

                <div className="mt-5 flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center">
                    <Image
                      src="/brand/microsoft-intune.svg"
                      alt=""
                      width={56}
                      height={56}
                      className="h-14 w-14 object-contain"
                    />
                  </div>
                  <div>
                    <h3
                      className="text-xl font-semibold text-text-primary"
                      translate="no"
                    >
                      Microsoft Intune
                    </h3>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-success">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <T>Ready to upload</T>
                    </p>
                  </div>
                </div>

                <p className="mt-5 border-t border-overlay/10 pt-4 text-sm leading-relaxed text-text-secondary">
                  <T>
                    IntuneGet packages the app and tracks the upload through to
                    completion.
                  </T>
                </p>
              </article>
            </li>
          </ol>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mx-auto mt-12 grid max-w-6xl divide-y divide-overlay/10 overflow-hidden rounded-2xl border border-overlay/10 bg-bg-surface/60 shadow-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {proofPoints.map(({ title, description, icon: Icon }) => (
              <div key={title} className="flex gap-3 p-5 md:p-6">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="font-semibold text-text-primary">
                    <T>{title}</T>
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                    <T>{description}</T>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </FadeIn>

        <FadeIn delay={0.36}>
          <div className="mt-9 text-center">
            <Link
              href="/blog/deploy-winget-apps-to-intune"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 font-medium text-accent-cyan transition-colors hover:text-accent-cyan-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
            >
              <T>View the full workflow</T>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
