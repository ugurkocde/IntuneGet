"use client";

import { FadeIn } from "../animations/FadeIn";

const facts = [
  { label: "Type", value: "Free, open-source Intune app deployment tool" },
  { label: "Apps Supported", value: "13,000+ from Winget repository" },
  { label: "Deployment Time", value: "~5 minutes per app" },
  { label: "Cost", value: "$0 (free, open source)" },
  { label: "Platform", value: "Web-based (self-host or hosted)" },
];

export function QuickFactsSection() {
  return (
    <section className="relative w-full py-12 md:py-16 overflow-hidden">
      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        <FadeIn>
          <div className="p-6 md:p-8 rounded-2xl bg-bg-elevated border border-overlay/[0.06] shadow-card">
            <h2 className="text-lg font-bold text-text-primary mb-6">
              IntuneGet Quick Facts
            </h2>
            <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
              {facts.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt className="text-xs font-medium text-text-muted uppercase tracking-wider">
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
