"use client";

import { Code2, Container, MonitorCheck, Package, Scale, ShieldCheck } from "lucide-react";
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
      <div className="container relative z-10 mx-auto flex min-h-dvh max-w-6xl items-center px-4 pb-12 pt-24 md:px-6 md:pb-14 md:pt-28 xl:max-w-7xl">
        <div className="grid w-full grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,54fr)_minmax(0,46fr)] lg:gap-16 xl:gap-24">
          {/* Left: copy + search */}
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <FadeIn animateOnMount duration={0.4} direction="up">
              <h1 className="text-balance text-5xl font-extrabold tracking-tight text-text-primary md:text-[3.5rem] md:leading-[1.08] xl:text-[4.25rem] xl:leading-[1.06]">
                <T id="hero.headline">Deploy any Windows app to Intune.</T>{" "}
                <span className="text-accent-cyan">
                  <T id="hero.headline.accent">Search it, ship it.</T>
                </span>
              </h1>
            </FadeIn>

            <FadeIn delay={0.08} animateOnMount duration={0.4} direction="up">
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-text-secondary md:text-xl xl:mt-7 xl:max-w-2xl xl:text-[1.375rem]">
                {appsSupported > 0 ? (
                  <T id="hero.subheadline">
                    IntuneGet turns the Winget catalog of <Var>{supportedAppsDisplay}</Var>+ apps
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
              {/* Flowing row: items wrap between chips, never inside a label. */}
              <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-1 rounded-2xl border border-overlay/[0.07] bg-bg-elevated/60 px-5 py-2.5 text-sm text-text-secondary shadow-soft lg:justify-start xl:gap-x-8 xl:px-6 xl:py-3 xl:text-[15px]">
                <span className="flex min-h-9 items-center gap-2 whitespace-nowrap">
                  <MonitorCheck aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
                  <T>Tested on real machines</T>
                </span>
                <span className="flex min-h-9 items-center gap-2 whitespace-nowrap">
                  <ShieldCheck aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
                  <T>VirusTotal checked</T>
                </span>
                <span className="flex min-h-9 items-center gap-2 whitespace-nowrap">
                  <Code2 aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
                  <T>No scripting</T>
                </span>
                <span className="flex min-h-9 items-center gap-2 whitespace-nowrap">
                  <Package aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
                  <T>No per-device fees</T>
                </span>
                <span className="flex min-h-9 items-center gap-2 whitespace-nowrap">
                  <Container aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
                  <T>Self-hostable</T>
                </span>
                <span className="flex min-h-9 items-center gap-2 whitespace-nowrap">
                  <Scale aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
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
                Live from the public QA pipeline: every package is test-installed, detection-checked,
                and uninstalled on a real Windows machine, and installer hashes are checked against
                VirusTotal. Flagged installers are blocked.
              </T>
            </p>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
