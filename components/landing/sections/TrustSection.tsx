"use client";

import { FadeIn } from "../animations/FadeIn";
import { CountUp } from "../animations/CountUp";
import { useLandingStats } from "@/hooks/useLandingStats";

export function TrustSection() {
  const { signinClicks, appsSupported, appsDeployed } = useLandingStats();

  const metrics = [
    { value: appsSupported, suffix: "", label: "Apps Available" },
    { value: appsDeployed, suffix: "", label: "Apps Deployed" },
    { value: signinClicks, suffix: "", label: "Admins" },
    { value: 99.9, suffix: "%", label: "Uptime", decimals: 1 },
  ];

  return (
    <section className="relative w-full py-16 md:py-20 bg-white border-y border-stone-200/60">
      <div className="container relative px-4 md:px-6 mx-auto max-w-6xl">
        {/* Quantified headline */}
        <FadeIn>
          <div className="text-center mb-10 md:mb-12">
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-stone-900 mb-3">
              Trusted by <span className="gradient-text-cyan">{signinClicks.toLocaleString()}</span> Admins
            </h2>
            <p className="text-stone-500 max-w-xl mx-auto">
              From startups to enterprises, teams rely on IntuneGet to streamline their app deployments
            </p>
          </div>
        </FadeIn>

        {/* Key metrics */}
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-12">
            {metrics.map((metric, index) => (
              <div key={metric.label} className="text-center">
                <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-stone-900 mb-1">
                  <CountUp
                    end={metric.value}
                    suffix={metric.suffix}
                    decimals={metric.decimals || 0}
                    delay={0.2 + index * 0.1}
                  />
                </div>
                <div className="text-xs sm:text-sm text-stone-500">{metric.label}</div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
