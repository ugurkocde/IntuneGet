"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { Code2, Container, Package, Scale } from "lucide-react";
import { T, Var, useGT, useLocale } from "gt-next";
import { GradientOrb } from "../ui/GradientOrb";
import { LandingCatalogSearch } from "../ui/LandingCatalogSearch";
import { FadeIn } from "../animations/FadeIn";
import { TextReveal } from "../animations/TextReveal";
import { type LandingStatValues } from "@/hooks/useLandingStats";
import { useSharedLandingStats } from "@/components/providers/LandingStatsProvider";

interface HeroSectionProps {
  initialStats?: LandingStatValues;
}

export function HeroSection({ initialStats }: HeroSectionProps) {
  const t = useGT();
  // gt-next locale is identical on server and client; the browser's implicit
  // locale is not, and a bare toLocaleString() breaks hydration for non-en users.
  // An empty locale string would make toLocaleString throw a RangeError.
  const localeTag = useLocale() || undefined;
  const { appsSupported } = useSharedLandingStats(initialStats);
  const shouldReduceMotion = useReducedMotion();
  const sectionRef = useRef<HTMLElement>(null);
  const supportedAppsDisplay = appsSupported.toLocaleString(localeTag);

  // 3B: Parallax for gradient orbs
  const { scrollY } = useScroll();
  const orbY1 = useTransform(scrollY, [0, 500], [0, -30]);
  const orbY2 = useTransform(scrollY, [0, 500], [0, -20]);

  return (
    <section ref={sectionRef} className="relative isolate min-h-dvh w-full overflow-hidden">
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

      <div className="container relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center px-4 pb-12 pt-24 md:px-6 md:pb-16 md:pt-24">
        <div className="flex w-full flex-col items-center text-center">
          <div className="flex max-w-4xl flex-col items-center space-y-5">
            <TextReveal
              as="h1"
              text={t("From Winget to Intune in Minutes")}
              className="text-balance text-4xl font-extrabold tracking-tight text-text-primary md:text-5xl lg:text-6xl"
              animateOnMount
              delay={0.05}
              staggerDelay={0.04}
            />

            <FadeIn delay={0.1} animateOnMount duration={0.4} direction="up">
              <p className="mx-auto max-w-3xl text-base leading-relaxed text-text-secondary sm:text-lg md:text-xl">
                {appsSupported > 0 ? (
                  <T id="hero.subheadline">
                    Search <Var>{supportedAppsDisplay}</Var>+ Winget packages for free. When you find your app,
                    sign in and upload it to Microsoft Intune - no scripting required.
                  </T>
                ) : (
                  <T id="hero.subheadline.nocount">
                    Search the Winget catalog for free. When you find your app,
                    sign in and upload it to Microsoft Intune - no scripting required.
                  </T>
                )}
              </p>
            </FadeIn>
          </div>

          <FadeIn delay={0.16} animateOnMount duration={0.45} direction="up" className="mt-7 w-full md:mt-8">
            <LandingCatalogSearch />
          </FadeIn>

          <FadeIn delay={0.24} animateOnMount duration={0.4} direction="up" className="mt-5 w-full md:mt-6">
            <div className="grid grid-cols-2 gap-x-3 rounded-2xl border border-overlay/[0.07] bg-bg-elevated/60 px-3 py-2 text-xs text-text-secondary shadow-soft sm:text-sm lg:grid-cols-4 lg:px-6 lg:py-3">
              <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start lg:justify-center">
                <Code2 aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                <T>No scripting</T>
              </span>
              <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start lg:justify-center">
                <Package aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                <T>No per-device fees</T>
              </span>
              <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start lg:justify-center">
                <Container aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                <T>Self-hostable</T>
              </span>
              <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start lg:justify-center">
                <Scale aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                <T>Open source, AGPL-3.0</T>
              </span>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
