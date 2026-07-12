"use client";

import Link from "next/link";
import {
  ArrowRight,
  BadgeDollarSign,
  Boxes,
  Check,
  LifeBuoy,
  PackageCheck,
  RefreshCw,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { T } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { SlideIn } from "../animations/SlideIn";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  feature: string;
  icon: LucideIcon;
  intuneGet: string;
  paidTools: string;
  manual: string;
}

interface ComparisonOption {
  key: "intuneGet" | "paidTools" | "manual";
  name: string;
  positioning: string;
  description: string;
  featured?: boolean;
}

const comparisonData: ComparisonRow[] = [
  {
    feature: "Cost",
    icon: BadgeDollarSign,
    intuneGet: "Free and open source",
    paidTools: "Subscription licensing",
    manual: "Your team's time",
  },
  {
    feature: "App catalog",
    icon: Boxes,
    intuneGet: "Supported Winget catalog",
    paidTools: "Vendor-curated catalog",
    manual: "Anything you package",
  },
  {
    feature: "Time per app",
    icon: Timer,
    intuneGet: "About 5 minutes",
    paidTools: "Minutes",
    manual: "Often hours",
  },
  {
    feature: "Packaging and detection",
    icon: PackageCheck,
    intuneGet: "Generated automatically",
    paidTools: "Generated automatically",
    manual: "Built and tested by you",
  },
  {
    feature: "Updates",
    icon: RefreshCw,
    intuneGet: "Flexible update policies",
    paidTools: "Vendor-managed options",
    manual: "You own the workflow",
  },
  {
    feature: "Support",
    icon: LifeBuoy,
    intuneGet: "Community on GitHub",
    paidTools: "Commercial support and SLAs",
    manual: "Internal expertise",
  },
];

const comparisonOptions: ComparisonOption[] = [
  {
    key: "intuneGet",
    name: "IntuneGet",
    positioning: "Best balance",
    description: "Fast, transparent, and self-hostable.",
    featured: true,
  },
  {
    key: "paidTools",
    name: "Paid packaging tools",
    positioning: "Commercial assurance",
    description: "Best when a vendor SLA is essential.",
  },
  {
    key: "manual",
    name: "Manual / DIY",
    positioning: "Maximum control",
    description: "Best for bespoke packaging workflows.",
  },
];

export function ComparisonSection() {
  return (
    <section
      id="comparison"
      className="relative w-full overflow-hidden bg-bg-surface py-20 md:py-28"
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-70"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--accent-cyan) 10%, transparent), transparent 62%)",
        }}
      />

      <div className="container relative mx-auto max-w-6xl px-4 md:px-6">
        <div className="mx-auto mb-10 max-w-3xl text-center md:mb-14">
          <FadeIn>
            <span className="mb-4 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-accent-cyan">
              <span className="h-px w-5 bg-accent-cyan/60" aria-hidden="true" />
              <T id="comparison.badge">Compare your options</T>
              <span className="h-px w-5 bg-accent-cyan/60" aria-hidden="true" />
            </span>
          </FadeIn>
          <SlideIn direction="up" distance={24} duration={0.5} delay={0.05}>
            <h2 className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl lg:text-5xl">
              <T id="comparison.heading">
                Choose the workflow that fits your team
              </T>
            </h2>
          </SlideIn>
          <FadeIn delay={0.12}>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-text-secondary md:text-lg">
              <T id="comparison.subheading">
                The same Intune destination, with very different trade-offs in
                time, control, cost, and support.
              </T>
            </p>
          </FadeIn>
        </div>

        {/* Mobile: one complete card per workflow keeps the options scannable. */}
        <div className="grid gap-4 md:hidden">
          {comparisonOptions.map((option, optionIndex) => (
            <FadeIn key={option.key} delay={0.08 * optionIndex}>
              <article
                className={cn(
                  "overflow-hidden rounded-2xl border bg-bg-elevated shadow-card",
                  option.featured
                    ? "border-accent-cyan/40 ring-1 ring-accent-cyan/15"
                    : "border-overlay/10"
                )}
              >
                <header
                  className={cn(
                    "flex items-start justify-between gap-4 border-b px-5 py-4",
                    option.featured
                      ? "border-accent-cyan/20 bg-accent-cyan/[0.07]"
                      : "border-overlay/10"
                  )}
                >
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold text-text-primary">
                      {option.featured && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-cyan text-bg-deepest">
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}
                      <T>{option.name}</T>
                    </h3>
                    <p className="mt-1 text-sm text-text-muted">
                      <T>{option.description}</T>
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider",
                      option.featured
                        ? "bg-accent-cyan/15 text-accent-cyan"
                        : "bg-overlay/[0.05] text-text-muted"
                    )}
                  >
                    <T>{option.positioning}</T>
                  </span>
                </header>
                <dl className="divide-y divide-overlay/10 px-5">
                  {comparisonData.map((row) => {
                    const DecisionIcon = row.icon;

                    return (
                      <div
                        key={row.feature}
                        className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 py-3.5"
                      >
                        <dt className="flex items-center gap-2 text-xs font-medium text-text-muted">
                          <DecisionIcon
                            className="h-4 w-4 shrink-0 text-accent-cyan"
                            strokeWidth={1.8}
                            aria-hidden="true"
                          />
                          <T>{row.feature}</T>
                        </dt>
                        <dd className="text-right text-sm font-medium leading-snug text-text-primary">
                          <T>{row[option.key]}</T>
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            </FadeIn>
          ))}
        </div>

        {/* Desktop: a compact decision matrix with an intentionally quiet hierarchy. */}
        <FadeIn delay={0.18} className="hidden md:block">
          <div className="overflow-hidden rounded-3xl border border-overlay/10 bg-bg-elevated shadow-card">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                <T>
                  Comparison of IntuneGet, paid packaging tools, and manual app
                  packaging for Microsoft Intune
                </T>
              </caption>
              <thead>
                <tr className="border-b border-overlay/10 align-top">
                  <th scope="col" className="w-[22%] p-5 text-left lg:p-6">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
                      <T>Decision factor</T>
                    </span>
                  </th>
                  {comparisonOptions.map((option) => (
                    <th
                      key={option.key}
                      scope="col"
                      className={cn(
                        "relative w-[26%] p-5 text-left lg:p-6",
                        option.featured && "bg-accent-cyan/[0.07]"
                      )}
                    >
                      {option.featured && (
                        <span
                          className="absolute inset-x-0 top-0 h-1 bg-accent-cyan"
                          aria-hidden="true"
                        />
                      )}
                      <div className="flex flex-col items-start gap-2">
                        <span className="font-semibold text-text-primary">
                          <T>{option.name}</T>
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                            option.featured
                              ? "bg-accent-cyan/15 text-accent-cyan"
                              : "bg-overlay/[0.05] text-text-muted"
                          )}
                        >
                          <T>{option.positioning}</T>
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-normal leading-relaxed text-text-muted">
                        <T>{option.description}</T>
                      </p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, rowIndex) => {
                  const DecisionIcon = row.icon;

                  return (
                    <tr
                      key={row.feature}
                      className={cn(
                        rowIndex !== comparisonData.length - 1 &&
                          "border-b border-overlay/10"
                      )}
                    >
                      <th
                        scope="row"
                        className="p-5 text-left text-sm font-semibold text-text-primary lg:px-6"
                      >
                        <span className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-cyan/[0.08] text-accent-cyan ring-1 ring-inset ring-accent-cyan/10">
                            <DecisionIcon
                              className="h-4 w-4"
                              strokeWidth={1.8}
                              aria-hidden="true"
                            />
                          </span>
                          <T>{row.feature}</T>
                        </span>
                      </th>
                      {comparisonOptions.map((option) => (
                        <td
                          key={option.key}
                          className={cn(
                            "p-5 text-sm leading-relaxed text-text-secondary lg:px-6",
                            option.featured &&
                              "bg-accent-cyan/[0.045] font-medium text-text-primary"
                          )}
                        >
                          <T>{row[option.key]}</T>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </FadeIn>

        <FadeIn delay={0.26}>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 text-center sm:flex-row sm:gap-5">
            <p className="text-sm text-text-muted">
              <T>No seat limits, no per-device fees, and no lock-in.</T>
            </p>
            <Link
              href="/apps"
              className="group inline-flex items-center gap-2 rounded-xl bg-accent-cyan px-4 py-2.5 text-sm font-semibold text-bg-deepest shadow-sm transition-[transform,box-shadow,background-color] hover:-translate-y-0.5 hover:bg-accent-cyan-dim hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface"
            >
              <T>Explore the app catalog</T>
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
