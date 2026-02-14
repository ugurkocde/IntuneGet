"use client";

import { FadeIn } from "../animations/FadeIn";
import { CountUp } from "../animations/CountUp";
import { useLandingStats } from "@/hooks/useLandingStats";

const quickFacts = [
  { label: "Type", value: "Free, open-source deployment tool" },
  { label: "Deployment Time", value: "~5 minutes per app" },
  { label: "Cost", value: "$0 (free, open source)" },
  { label: "Platform", value: "Web-based (self-host or hosted)" },
];

export function TrustSection() {
  const { signinClicks, appsSupported, appsDeployed } = useLandingStats();

  const metrics = [
    { value: appsSupported, suffix: "", label: "Apps Available" },
    { value: appsDeployed, suffix: "", label: "Apps Deployed" },
    { value: signinClicks, suffix: "", label: "Admins" },
  ];

  return (
    <section className="relative w-full py-16 md:py-20 bg-bg-elevated border-y border-overlay/[0.06]">
      <div className="container relative px-4 md:px-6 mx-auto max-w-6xl">
        {/* Headline */}
        <FadeIn>
          <div className="text-center mb-10 md:mb-12">
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-text-primary mb-3">
              Open Source & Trusted
            </h2>
            <p className="text-text-muted max-w-xl mx-auto">
              From startups to enterprises, teams rely on IntuneGet to streamline their app deployments
            </p>
          </div>
        </FadeIn>

        {/* Key metrics */}
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-3 gap-6 md:gap-12 mb-10 md:mb-12">
            {metrics.map((metric, index) => (
              <div key={metric.label} className="text-center">
                <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-text-primary mb-1">
                  <CountUp
                    end={metric.value}
                    suffix={metric.suffix}
                    delay={0.2 + index * 0.1}
                  />
                </div>
                <div className="text-xs sm:text-sm text-text-muted">{metric.label}</div>
              </div>
            ))}
          </div>
        </FadeIn>

        {/* Quick Facts strip */}
        <FadeIn delay={0.2}>
          <div className="p-5 md:p-6 rounded-2xl bg-bg-surface border border-overlay/[0.06]">
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
              {quickFacts.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                    {fact.label}
                  </dt>
                  <dd className="text-sm font-medium text-text-primary mt-1">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
