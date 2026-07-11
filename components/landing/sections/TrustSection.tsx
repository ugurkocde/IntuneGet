"use client";

import Link from "next/link";
import { ArrowRight, MapPin, Send, Server, ShieldCheck } from "lucide-react";
import { Github } from "@/components/icons/brand-icons";
import { T } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { CountUp } from "../animations/CountUp";
import { useLandingStats, type LandingStatValues } from "@/hooks/useLandingStats";

interface TrustSectionProps {
  initialStats?: LandingStatValues;
}

const pillars = [
  {
    icon: Github,
    title: "Open source",
    description:
      "Licensed under AGPL-3.0. Every line of code is public and auditable.",
    href: "https://github.com/ugurkocde/IntuneGet",
    linkLabel: "View the code on GitHub",
    external: true,
  },
  {
    icon: Server,
    title: "Self-hostable",
    description:
      "Run it on your own infrastructure with Docker and SQLite - zero external dependencies.",
    href: null,
    linkLabel: null,
    external: false,
  },
  {
    icon: MapPin,
    title: "EU data residency",
    description:
      "Metadata is stored in Frankfurt. Installers are never stored, and your tokens never leave your browser.",
    href: "/security",
    linkLabel: "Read the security details",
    external: false,
  },
  {
    icon: Send,
    title: "Direct to your tenant",
    description:
      "Packaged apps upload straight to your own Intune tenant - no intermediate app store.",
    href: "/security",
    linkLabel: "Read the security details",
    external: false,
  },
];

const permissionFacts = [
  "Signing in reads only your basic profile - nothing else.",
  "Five application permissions, granted once by an admin through tenant-wide admin consent.",
  "Three of the five permissions are read-only.",
];

const quickFacts = [
  { label: "Type", value: "Free, open-source deployment tool" },
  { label: "Deployment Time", value: "About 5 minutes per app" },
  { label: "Cost", value: "$0 (free, open source)" },
  { label: "Platform", value: "Web-based (self-host or hosted)" },
];

export function TrustSection({ initialStats }: TrustSectionProps) {
  const { appsSupported, appsDeployed } = useLandingStats(initialStats);

  // Hide zero-valued tiles (self-hosted deployments without Supabase counters)
  const metrics = [
    { value: appsDeployed, label: "Apps deployed" },
    { value: appsSupported, label: "Apps in catalog" },
  ].filter((metric) => metric.value > 0);

  return (
    <section className="relative w-full py-20 md:py-28 bg-bg-elevated">
      <div className="container relative px-4 md:px-6 mx-auto max-w-6xl">
        {/* Headline */}
        <FadeIn>
          <div className="text-center mb-10 md:mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary mb-3">
              <T id="trust.heading">Open Source & Trusted</T>
            </h2>
            <p className="text-text-muted max-w-xl mx-auto">
              <T id="trust.subheading">
                Every claim here is verifiable: the code is public, the numbers
                are live, and the permissions are documented.
              </T>
            </p>
          </div>
        </FadeIn>

        {/* Trust pillars */}
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10 md:mb-12">
            {pillars.map((pillar) => (
              <div
                key={pillar.title}
                className="flex flex-col p-5 rounded-2xl bg-bg-surface border border-overlay/10"
              >
                <div className="w-10 h-10 rounded-xl bg-accent-cyan/10 flex items-center justify-center mb-4">
                  <pillar.icon className="w-5 h-5 text-accent-cyan" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-text-primary mb-1.5">
                  <T>{pillar.title}</T>
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                  <T>{pillar.description}</T>
                </p>
                {pillar.href && pillar.linkLabel && (
                  <span className="mt-auto pt-3">
                    {pillar.external ? (
                      <a
                        href={pillar.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-medium text-accent-cyan hover:text-accent-cyan-dim transition-colors"
                      >
                        <T>{pillar.linkLabel}</T>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </a>
                    ) : (
                      <Link
                        href={pillar.href}
                        className="inline-flex items-center gap-1 text-sm font-medium text-accent-cyan hover:text-accent-cyan-dim transition-colors"
                      >
                        <T>{pillar.linkLabel}</T>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        </FadeIn>

        {/* Honest metrics */}
        {metrics.length > 0 && (
          <FadeIn delay={0.15}>
            <div className="grid grid-cols-2 divide-x divide-overlay/10 mb-10 md:mb-12">
              {metrics.map((metric, index) => (
                <div key={metric.label} className="text-center">
                  <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-text-primary mb-1">
                    <CountUp end={metric.value} delay={0.2 + index * 0.1} />
                  </div>
                  <div className="text-xs sm:text-sm text-text-muted">
                    <T>{metric.label}</T>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        )}

        {/* Quick Facts strip */}
        <FadeIn delay={0.2}>
          <div className="p-5 md:p-6 rounded-2xl bg-bg-surface border border-overlay/10">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
              {quickFacts.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                    <T>{fact.label}</T>
                  </dt>
                  <dd className="text-sm font-medium text-text-primary mt-1">
                    <T>{fact.value}</T>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </FadeIn>

        {/* Permissions and access */}
        <FadeIn delay={0.25}>
          <div className="mt-6 p-5 md:p-6 rounded-2xl bg-bg-surface border border-overlay/10">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary mb-3">
              <ShieldCheck className="w-4 h-4 text-accent-cyan" aria-hidden="true" />
              <T id="trust.permissions.heading">Permissions and access</T>
            </h3>
            <ul className="grid gap-2 md:grid-cols-3 md:gap-6 mb-4">
              {permissionFacts.map((fact) => (
                <li
                  key={fact}
                  className="text-sm text-text-secondary leading-relaxed"
                >
                  <T>{fact}</T>
                </li>
              ))}
            </ul>
            <Link
              href="/security"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-cyan hover:text-accent-cyan-dim transition-colors"
            >
              <T id="trust.permissions.link">
                See exactly what IntuneGet can and cannot do
              </T>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          </div>
        </FadeIn>

        {/* Founder note */}
        <FadeIn delay={0.3}>
          <figure className="mt-10 md:mt-12 flex flex-col sm:flex-row items-start sm:items-center gap-4 max-w-2xl mx-auto">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-accent-cyan to-accent-cyan-dim flex items-center justify-center text-white font-bold text-lg">
              UK
            </div>
            <div>
              <blockquote className="text-text-secondary leading-relaxed">
                <T id="trust.founder.quote">
                  &ldquo;I built IntuneGet because I was tired of spending my
                  Fridays packaging apps instead of solving real problems. If
                  this tool saves you even one afternoon, it&apos;s done its
                  job.&rdquo;
                </T>
              </blockquote>
              <figcaption className="text-sm text-text-muted mt-2">
                <T id="trust.founder.attribution">
                  <span className="font-medium text-text-secondary">
                    Ugur Koc
                  </span>{" "}
                  - Creator of IntuneGet
                </T>
              </figcaption>
            </div>
          </figure>
        </FadeIn>
      </div>
    </section>
  );
}
