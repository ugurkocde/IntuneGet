"use client";

import { Check, X, Minus } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { FadeIn } from "../animations/FadeIn";
import { SlideIn } from "../animations/SlideIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { scaleIn } from "@/lib/animations/variants";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  feature: string;
  intuneGet: string | boolean;
  manual: string | boolean;
}

const comparisonData: ComparisonRow[] = [
  {
    feature: "Price",
    intuneGet: "Free",
    manual: "Free (your time)",
  },
  {
    feature: "Apps Supported",
    intuneGet: "10,000+",
    manual: "Unlimited",
  },
  {
    feature: "Setup Time",
    intuneGet: "5 minutes",
    manual: "N/A",
  },
  {
    feature: "Time per Deployment",
    intuneGet: "~5 minutes",
    manual: "8+ hours",
  },
  {
    feature: "IntuneWin Packaging",
    intuneGet: "Automatic",
    manual: "Manual",
  },
  {
    feature: "Detection Rules",
    intuneGet: "Auto-generated",
    manual: "Manual",
  },
  {
    feature: "Automatic Updates",
    intuneGet: true,
    manual: false,
  },
  {
    feature: "AI-Powered Discovery",
    intuneGet: true,
    manual: false,
  },
  {
    feature: "PSADT v4 Support",
    intuneGet: true,
    manual: false,
  },
];

function CellContent({ value }: { value: string | boolean }) {
  if (typeof value === "boolean") {
    return value ? (
      <Check className="w-5 h-5 text-emerald-500 mx-auto" />
    ) : (
      <X className="w-5 h-5 text-red-400 mx-auto" />
    );
  }
  if (value === "N/A") {
    return <Minus className="w-5 h-5 text-stone-300 mx-auto" />;
  }
  return <span className="text-sm text-stone-700">{value}</span>;
}

export function ComparisonSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative w-full py-24 md:py-32 overflow-hidden bg-stone-50">
      <div className="container relative px-4 md:px-6 mx-auto max-w-5xl">
        {/* Section header - ScaleIn tag + SlideIn headline */}
        <div className="text-center mb-12 md:mb-16 space-y-4">
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : "hidden"}
            whileInView={shouldReduceMotion ? { opacity: 1 } : "visible"}
            viewport={{ once: true, amount: 0.3 }}
            variants={shouldReduceMotion ? undefined : scaleIn}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
          >
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              Comparison
            </span>
          </motion.div>
          <SlideIn direction="up" distance={30} duration={0.5} delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900">
              Why Choose IntuneGet?
            </h2>
          </SlideIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-stone-600">
              See how IntuneGet compares to manual deployment processes
            </p>
          </FadeIn>
        </div>

        {/* Comparison table - 5A: Staggered row reveal */}
        <FadeIn delay={0.3}>
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              {/* Table header */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="p-4">
                  <span className="sr-only">Feature</span>
                </div>
                <div className="p-4 text-center bg-accent-cyan/10 rounded-t-2xl border-2 border-b-0 border-accent-cyan/30">
                  <div className="font-bold text-stone-900">IntuneGet</div>
                  <div className="text-xs text-accent-cyan font-medium mt-1">Recommended</div>
                </div>
                <div className="p-4 text-center bg-white rounded-t-2xl border border-b-0 border-stone-200">
                  <div className="font-semibold text-stone-700">Manual Process</div>
                  <div className="text-xs text-stone-400 mt-1">DIY Approach</div>
                </div>
              </div>

              {/* Table body - staggered rows */}
              <StaggerContainer
                className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-card"
                staggerDelay={0.05}
              >
                {comparisonData.map((row, index) => (
                  <StaggerItem key={row.feature} direction="none">
                    <div
                      className={cn(
                        "grid grid-cols-3 gap-4",
                        index !== comparisonData.length - 1 && "border-b border-stone-100"
                      )}
                    >
                      <div className="p-4 flex items-center">
                        <span className="text-sm font-medium text-stone-900">{row.feature}</span>
                      </div>
                      <div className="p-4 flex items-center justify-center bg-accent-cyan/5 border-x border-accent-cyan/10">
                        <CellContent value={row.intuneGet} />
                      </div>
                      <div className="p-4 flex items-center justify-center">
                        <CellContent value={row.manual} />
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerContainer>

              {/* Bottom highlight for IntuneGet column */}
              <div className="grid grid-cols-3 gap-4 mt-0">
                <div></div>
                <div className="h-1 bg-gradient-to-r from-accent-cyan/50 via-accent-cyan to-accent-cyan/50 rounded-b-full"></div>
                <div></div>
              </div>
            </div>
          </div>
        </FadeIn>

        {/* Bottom note */}
        <FadeIn delay={0.4}>
          <p className="text-center text-sm text-stone-500 mt-8">
            IntuneGet has no surprise bills, no seat limits, and no hidden fees.
            Your data stays yours - export anytime with no lock-in.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}
