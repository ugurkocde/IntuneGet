"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  CloudDownload,
  FileCheck2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  GithubMark,
  MicrosoftMark,
} from "@/components/icons/brand-icons";
import { T } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { CountUp } from "../animations/CountUp";
import { type LandingStatValues } from "@/hooks/useLandingStats";
import { useSharedLandingStats } from "@/components/providers/LandingStatsProvider";
import { cn } from "@/lib/utils";

interface TrustSectionProps {
  initialStats?: LandingStatValues;
}

interface ProofPoint {
  visual: "github" | "docker" | "eu" | "permission";
  title: string;
  detail: string;
  href?: string;
  external?: boolean;
}

const proofPoints: ProofPoint[] = [
  {
    visual: "github",
    title: "Open source - AGPL-3.0",
    detail: "Full source available. Contributions welcome.",
    href: "https://github.com/ugurkocde/IntuneGet",
    external: true,
  },
  {
    visual: "docker",
    title: "Self-hostable - Docker + SQLite",
    detail: "Run in your environment with minimal components.",
  },
  {
    visual: "eu",
    title: "EU metadata - Frankfurt",
    detail: "Hosted metadata is stored in Frankfurt, EU.",
  },
  {
    visual: "permission",
    title: "Access documented - Review every permission",
    detail: "All requested permissions are documented for review.",
    href: "/security",
  },
];

function FlowConnector({
  label,
  icon: Icon,
  success = false,
}: {
  label: string;
  icon: LucideIcon;
  success?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-1 lg:min-w-0 lg:px-2 lg:py-0">
      <div className="hidden w-full items-center text-accent-cyan lg:flex">
        <span className="h-px flex-1 bg-accent-cyan/50" aria-hidden="true" />
        <ArrowRight className="-ml-px h-5 w-5 shrink-0" aria-hidden="true" />
      </div>
      <div className="flex flex-col items-center lg:mt-3">
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-full border",
            success
              ? "border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-400"
              : "border-accent-cyan/20 bg-accent-cyan/[0.08] text-accent-cyan"
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="mt-2 max-w-32 text-center text-xs font-semibold leading-snug text-text-primary">
          <T>{label}</T>
        </span>
        <ArrowDown
          className="mt-3 h-5 w-5 text-accent-cyan lg:hidden"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

export function TrustSection({ initialStats }: TrustSectionProps) {
  const { appsSupported, appsDeployed } = useSharedLandingStats(initialStats);

  // Self-hosted deployments may not expose public counters, so omit empty data.
  const metrics = [
    { value: appsSupported, label: "Apps in catalog" },
    { value: appsDeployed, label: "Apps deployed" },
  ].filter((metric) => metric.value > 0);

  return (
    <section
      id="trust"
      className="relative w-full scroll-mt-20 overflow-hidden bg-bg-elevated py-20 md:scroll-mt-24 md:py-28"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_50%_0%,var(--accent-cyan)_0%,transparent_65%)] opacity-[0.035]"
      />

      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <div className="mx-auto max-w-5xl text-center">
          <FadeIn>
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-cyan/25 bg-bg-surface px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-primary shadow-sm">
              <ShieldCheck
                className="h-4 w-4 text-accent-cyan"
                aria-hidden="true"
              />
              <T>Trust by design</T>
            </span>
          </FadeIn>

          <FadeIn delay={0.08}>
            <h2 className="mt-6 text-balance text-3xl font-bold tracking-tight text-text-primary sm:text-4xl lg:text-5xl">
              <T id="trust.heading">
                Your app goes to your tenant. Not ours.
              </T>
            </h2>
          </FadeIn>

          <FadeIn delay={0.14}>
            <p className="mx-auto mt-4 max-w-3xl text-pretty text-base leading-relaxed text-text-secondary md:text-lg">
              <T id="trust.subheading">
                A transparent path from the Winget catalog to Microsoft Intune.
              </T>
            </p>
          </FadeIn>
        </div>

        <FadeIn delay={0.2}>
          <div className="mt-10 rounded-3xl border border-overlay/10 bg-bg-surface p-4 shadow-card sm:p-6 lg:p-7">
            <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1.08fr)_9rem_minmax(0,1fr)] lg:gap-0">
              <article className="flex min-h-44 flex-col justify-center rounded-2xl border border-accent-cyan/20 bg-bg-elevated p-5 sm:flex-row sm:items-center sm:gap-5 lg:min-h-52 lg:flex-col lg:items-start lg:gap-0">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center">
                  <MicrosoftMark className="h-11 w-11" />
                </span>
                <div className="mt-4 sm:mt-0 lg:mt-4">
                  <h3 className="text-lg font-semibold text-text-primary">
                    <T>Winget catalog</T>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    <T>Public catalog of applications and manifests.</T>
                  </p>
                </div>
              </article>

              <FlowConnector
                label="Installer streamed, not stored"
                icon={CloudDownload}
              />

              <article className="flex min-h-44 flex-col justify-center rounded-2xl border border-accent-cyan/45 bg-bg-elevated p-5 shadow-sm sm:flex-row sm:items-center sm:gap-5 lg:min-h-52 lg:flex-col lg:items-start lg:gap-0">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center">
                  <Image
                    src="/favicon.svg"
                    alt="IntuneGet"
                    width={56}
                    height={56}
                    className="h-14 w-14 object-contain"
                  />
                </span>
                <div className="mt-4 sm:mt-0 lg:mt-4">
                  <h3 className="text-lg font-semibold text-text-primary">
                    <T>IntuneGet packaging</T>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    <T>Prepares and validates packages for deployment.</T>
                  </p>
                </div>
              </article>

              <FlowConnector
                label="Permissions checked"
                icon={CheckCircle2}
                success
              />

              <article className="flex min-h-44 flex-col justify-center rounded-2xl border border-emerald-500/25 bg-bg-elevated p-5 sm:flex-row sm:items-center sm:gap-5 lg:min-h-52 lg:flex-col lg:items-start lg:gap-0">
                <span className="flex h-16 w-16 shrink-0 items-center justify-center">
                  <Image
                    src="/brand/microsoft-intune.svg"
                    alt="Microsoft Intune"
                    width={56}
                    height={56}
                    className="h-14 w-14 object-contain"
                  />
                </span>
                <div className="mt-4 sm:mt-0 lg:mt-4">
                  <h3 className="text-lg font-semibold text-text-primary">
                    <T>Microsoft Intune</T>
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                    <T>
                      Package and metadata delivered directly to your tenant.
                    </T>
                  </p>
                </div>
              </article>
            </div>
          </div>
        </FadeIn>

        {metrics.length > 0 && (
          <FadeIn delay={0.26}>
            <div className="mx-auto mt-5 flex max-w-5xl flex-col overflow-hidden rounded-2xl border border-overlay/10 bg-bg-surface shadow-soft sm:flex-row sm:items-stretch">
              <div className="flex items-center justify-center gap-2 border-b border-overlay/10 px-5 py-4 sm:border-b-0 sm:border-r">
                <span
                  className="h-2.5 w-2.5 rounded-full bg-accent-cyan shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-cyan)_12%,transparent)]"
                  aria-hidden="true"
                />
                <span className="font-mono text-xs font-semibold uppercase tracking-wider text-accent-cyan">
                  <T>Live</T>
                </span>
              </div>

              <div
                className={cn(
                  "grid flex-1 divide-y divide-overlay/10 sm:divide-x sm:divide-y-0",
                  metrics.length === 1 ? "grid-cols-1" : "grid-cols-2"
                )}
              >
                {metrics.map((metric, index) => (
                  <div
                    key={metric.label}
                    className="flex items-center justify-center gap-3 px-4 py-4 text-center"
                  >
                    <span className="text-2xl font-bold tracking-tight text-text-primary md:text-3xl">
                      <CountUp end={metric.value} delay={0.28 + index * 0.08} />
                    </span>
                    <span className="text-xs font-medium text-text-secondary sm:text-sm">
                      <T>{metric.label}</T>
                    </span>
                  </div>
                ))}
              </div>

              <div className="hidden items-center border-l border-overlay/10 px-5 text-xs text-text-muted lg:flex">
                <T>Updated from live counters</T>
              </div>
            </div>
          </FadeIn>
        )}

        <FadeIn delay={0.32}>
          <div className="mt-6 grid overflow-hidden rounded-2xl border border-overlay/10 bg-bg-surface sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-overlay/10">
            {proofPoints.map((proof, index) => {
              const content = (
                <>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center text-accent-cyan">
                    {proof.visual === "github" && (
                      <GithubMark className="h-10 w-10 text-[#181717] dark:text-white" />
                    )}
                    {proof.visual === "docker" && (
                      <Image
                        src="/icons/Docker.DockerDesktop/icon-64.png"
                        alt=""
                        width={44}
                        height={44}
                        className="h-11 w-11 object-contain"
                      />
                    )}
                    {proof.visual === "eu" && (
                      <span
                        className="text-4xl leading-none"
                        role="img"
                        aria-label="European Union"
                      >
                        🇪🇺
                      </span>
                    )}
                    {proof.visual === "permission" && (
                      <FileCheck2 className="h-10 w-10" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold leading-snug text-text-primary">
                      <T>{proof.title}</T>
                    </span>
                    <span className="mt-1.5 block text-xs leading-relaxed text-text-muted">
                      <T>{proof.detail}</T>
                    </span>
                  </span>
                </>
              );

              const className = cn(
                "flex items-start gap-4 p-5 transition-colors",
                index > 0 && "border-t border-overlay/10 sm:border-t-0",
                index > 1 && "sm:border-t sm:border-overlay/10 lg:border-t-0",
                proof.href && "hover:bg-overlay/[0.025]"
              );

              if (!proof.href) {
                return (
                  <div key={proof.title} className={className}>
                    {content}
                  </div>
                );
              }

              return proof.external ? (
                <a
                  key={proof.title}
                  href={proof.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={className}
                >
                  {content}
                </a>
              ) : (
                <Link key={proof.title} href={proof.href} className={className}>
                  {content}
                </Link>
              );
            })}
          </div>
        </FadeIn>

        <FadeIn delay={0.38}>
          <div className="mt-8 text-center">
            <Link
              href="/security"
              className="group inline-flex items-center gap-2 text-sm font-semibold text-accent-cyan transition-colors hover:text-accent-cyan-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-4 focus-visible:ring-offset-bg-elevated"
            >
              <T>Read the security details</T>
              <ArrowRight
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
