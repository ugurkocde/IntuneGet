"use client";

import { useState } from "react";
import { T } from "gt-next";
import { Check, X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { FadeIn } from "../animations/FadeIn";
import { SlideIn } from "../animations/SlideIn";
import { scaleIn } from "@/lib/animations/variants";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  feature: string;
  intuneGet: string | boolean;
  paidTools: string | boolean;
  manual: string | boolean;
}

const comparisonData: ComparisonRow[] = [
  {
    feature: "Price",
    intuneGet: "Free and open source",
    paidTools: "Per-device or per-year licensing",
    manual: "Free (your time)",
  },
  {
    feature: "App catalog",
    intuneGet: "Full Winget catalog, pre-validated",
    paidTools: "Vendor-curated catalog",
    manual: "Anything you package yourself",
  },
  {
    feature: "Time per deployment",
    intuneGet: "About 5 minutes",
    paidTools: "Minutes",
    manual: "Hours per app",
  },
  {
    feature: "IntuneWin packaging",
    intuneGet: "Automatic",
    paidTools: "Automatic",
    manual: "Manual",
  },
  {
    feature: "Detection rules",
    intuneGet: "Auto-generated",
    paidTools: "Auto-generated",
    manual: "Manual",
  },
  {
    feature: "Automatic updates",
    intuneGet: true,
    paidTools: true,
    manual: false,
  },
  {
    feature: "Self-hosting",
    intuneGet: "Yes (Docker, SQLite)",
    paidTools: false,
    manual: "n/a",
  },
  {
    feature: "Vendor lock-in",
    intuneGet: "None (AGPL-3.0, export anytime)",
    paidTools: "Contract-dependent",
    manual: "None",
  },
  {
    feature: "Support and SLAs",
    intuneGet: "Community (GitHub)",
    paidTools: "Dedicated support, SLAs",
    manual: "None",
  },
  {
    feature: "PSADT v4 support",
    intuneGet: true,
    paidTools: "Varies",
    manual: "DIY",
  },
];

const MOBILE_PREVIEW_COUNT = 4;

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <span className="inline-flex">
        <Check className="w-5 h-5 text-emerald-500" aria-hidden="true" />
        <span className="sr-only">
          <T id="comparison.included">Included</T>
        </span>
      </span>
    ) : (
      <span className="inline-flex">
        <X className="w-5 h-5 text-red-400" aria-hidden="true" />
        <span className="sr-only">
          <T id="comparison.not-included">Not included</T>
        </span>
      </span>
    );
  }
  return (
    <span className="text-sm text-text-secondary">
      <T>{value}</T>
    </span>
  );
}

export function ComparisonSection() {
  const shouldReduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  const mobileRows = expanded
    ? comparisonData
    : comparisonData.slice(0, MOBILE_PREVIEW_COUNT);

  return (
    <section className="relative w-full py-20 md:py-28 overflow-hidden bg-bg-surface">
      <div className="container relative px-4 md:px-6 mx-auto max-w-5xl">
        {/* Section header */}
        <div className="text-center mb-12 md:mb-16 space-y-4">
          <motion.div
            initial={shouldReduceMotion ? { opacity: 1 } : "hidden"}
            whileInView={shouldReduceMotion ? { opacity: 1 } : "visible"}
            viewport={{ once: true, amount: 0.3 }}
            variants={shouldReduceMotion ? undefined : scaleIn}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
          >
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              <T id="comparison.badge">Comparison</T>
            </span>
          </motion.div>
          <SlideIn direction="up" distance={30} duration={0.5} delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary">
              <T id="comparison.heading">How IntuneGet Compares</T>
            </h2>
          </SlideIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-text-secondary">
              <T id="comparison.subheading">
                Manual Win32 packaging means hours per app and scripting
                expertise. IntuneGet packages and deploys in about 5 minutes -
                here is how it stacks up against the alternatives.
              </T>
            </p>
          </FadeIn>
        </div>

        {/* Mobile: stacked cards */}
        <div className="md:hidden">
          <FadeIn>
            <div className="space-y-3">
              {mobileRows.map((row) => (
                <div
                  key={row.feature}
                  className="rounded-xl bg-bg-elevated border border-overlay/10 shadow-card overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-overlay/10">
                    <span className="text-sm font-medium text-text-primary">
                      <T>{row.feature}</T>
                    </span>
                  </div>
                  <div className="divide-y divide-overlay/10">
                    <div className="flex items-center justify-between gap-4 px-4 py-3 bg-accent-cyan/5">
                      <span className="text-[10px] font-medium text-accent-cyan uppercase tracking-wider shrink-0">
                        IntuneGet
                      </span>
                      <div className="text-right">
                        <CellValue value={row.intuneGet} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider shrink-0">
                        <T id="comparison.paid-tools-short">Paid tools</T>
                      </span>
                      <div className="text-right">
                        <CellValue value={row.paidTools} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider shrink-0">
                        <T id="comparison.manual-short">Manual</T>
                      </span>
                      <div className="text-right">
                        <CellValue value={row.manual} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((prev) => !prev)}
              className="mt-4 w-full px-4 py-3 text-sm font-medium text-accent-cyan bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-colors"
            >
              {expanded ? (
                <T id="comparison.show-less">Show less</T>
              ) : (
                <T id="comparison.show-full">Show full comparison</T>
              )}
            </button>
          </FadeIn>
        </div>

        {/* Desktop: comparison table */}
        <FadeIn delay={0.3} className="hidden md:block">
          <div className="rounded-2xl bg-bg-elevated border border-overlay/10 shadow-card overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-overlay/10">
                  <th scope="col" className="p-4 text-left">
                    <span className="sr-only">
                      <T id="comparison.col-feature">Feature</T>
                    </span>
                  </th>
                  <th
                    scope="col"
                    className="p-4 text-center bg-accent-cyan/10 border-x-2 border-accent-cyan/30"
                  >
                    <div className="font-bold text-text-primary">IntuneGet</div>
                    <div className="text-xs text-accent-cyan font-medium mt-1">
                      <T id="comparison.recommended">Recommended</T>
                    </div>
                  </th>
                  <th scope="col" className="p-4 text-center">
                    <div className="font-semibold text-text-secondary">
                      <T id="comparison.col-paid-tools">
                        Paid packaging tools
                      </T>
                    </div>
                  </th>
                  <th scope="col" className="p-4 text-center">
                    <div className="font-semibold text-text-secondary">
                      <T id="comparison.col-manual">Manual / DIY</T>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, index) => (
                  <tr
                    key={row.feature}
                    className={cn(
                      index !== comparisonData.length - 1 &&
                        "border-b border-overlay/10"
                    )}
                  >
                    <th
                      scope="row"
                      className="p-4 text-left text-sm font-medium text-text-primary"
                    >
                      <T>{row.feature}</T>
                    </th>
                    <td className="p-4 bg-accent-cyan/5 border-x border-accent-cyan/10">
                      <div className="flex items-center justify-center text-center">
                        <CellValue value={row.intuneGet} />
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center text-center">
                        <CellValue value={row.paidTools} />
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center text-center">
                        <CellValue value={row.manual} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FadeIn>

        {/* Bottom note */}
        <FadeIn delay={0.4}>
          <p className="text-center text-sm text-text-muted mt-8">
            <T id="comparison.note">
              IntuneGet has no surprise bills, no seat limits, and no hidden
              fees. Your data stays yours - export anytime with no lock-in.
            </T>
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
