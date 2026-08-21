"use client";

import { Code2, Container, Package, Scale } from "lucide-react";
import { T, Var, useLocale } from "gt-next";
import { LandingCatalogSearch } from "../ui/LandingCatalogSearch";
import { LivePipelinePanel } from "../ui/LivePipelinePanel";
import { FadeIn } from "../animations/FadeIn";
import { type LandingStatValues } from "@/hooks/useLandingStats";
import { useSharedLandingStats } from "@/components/providers/LandingStatsProvider";

interface HeroSectionProps {
  initialStats?: LandingStatValues;
}

export function HeroSection({ initialStats }: HeroSectionProps) {
  // gt-next locale is identical on server and client; the browser's implicit
  // locale is not, and a bare toLocaleString() breaks hydration for non-en users.
  // An empty locale string would make toLocaleString throw a RangeError.
  const localeTag = useLocale() || undefined;
  const { appsSupported } = useSharedLandingStats(initialStats);
  const supportedAppsDisplay = appsSupported.toLocaleString(localeTag);

  return (
    <section className="relative isolate w-full overflow-hidden">
      <div className="container relative z-10 mx-auto max-w-6xl px-4 pb-14 pt-28 md:px-6 md:pb-20 md:pt-32">
        <div className="grid items-center gap-12 lg:grid-cols-[54fr_46fr] lg:gap-16">
          {/* Left: copy + search */}
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <FadeIn animateOnMount duration={0.4} direction="up">
              <h1 className="text-balance text-4xl font-extrabold tracking-tight text-text-primary md:text-5xl">
                <T id="hero.headline">Deploy any Windows app to Intune.</T>{" "}
                <span className="text-accent-cyan">
                  <T id="hero.headline.accent">Search it, ship it.</T>
                </span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.08} animateOnMount duration={0.4} direction="up">
              <p className="mt-5 max-w-xl text-base leading-relaxed text-text-secondary md:text-lg">
                {appsSupported > 0 ? (
                  <T id="hero.subheadline">
                    IntuneGet turns the Winget catalog — <Var>{supportedAppsDisplay}</Var>+ apps —
                    into ready-to-deploy Intune packages: detection rules, silent switches, and
                    updates handled for you. No scripting required.
                  </T>
                ) : (
                  <T id="hero.subheadline.nocount">
                    IntuneGet turns the Winget catalog into ready-to-deploy Intune packages:
                    detection rules, silent switches, and updates handled for you. No scripting
                    required.
                  </T>
                )}
              </p>
            </FadeIn>

            <FadeIn delay={0.16} animateOnMount duration={0.45} direction="up" className="mt-7 w-full">
              <LandingCatalogSearch />
            </FadeIn>

            <FadeIn delay={0.24} animateOnMount duration={0.4} direction="up" className="mt-5 w-full md:mt-6">
              <div className="grid grid-cols-2 gap-x-3 rounded-2xl border border-overlay/[0.07] bg-bg-elevated/60 px-3 py-2 text-xs text-text-secondary shadow-soft sm:text-sm lg:px-5">
                <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start">
                  <Code2 aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                  <T>No scripting</T>
                </span>
                <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start">
                  <Package aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                  <T>No per-device fees</T>
                </span>
                <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start">
                  <Container aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                  <T>Self-hostable</T>
                </span>
                <span className="flex min-h-10 items-center justify-center gap-2 sm:justify-start">
                  <Scale aria-hidden="true" className="h-4 w-4 text-accent-cyan" />
                  <T>Open source, AGPL-3.0</T>
                </span>
              </div>
            </FadeIn>
          </div>

          {/* Right: real-time QA pipeline */}
          <FadeIn delay={0.2} animateOnMount duration={0.45} direction="up">
            <LivePipelinePanel />
            <p className="mt-3 px-1 text-xs text-text-muted">
              <T id="hero.pipeline.caption">
                Live from the public QA pipeline — every result above is a real run on a real
                machine.
              </T>
            </p>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
