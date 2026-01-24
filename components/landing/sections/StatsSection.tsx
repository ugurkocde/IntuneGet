"use client";

import { FadeIn } from "../animations/FadeIn";
import { CountUp } from "../animations/CountUp";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";

const stats = [
  {
    value: 10000,
    suffix: "+",
    label: "Apps Available",
    description: "In Winget repository",
  },
  {
    value: 500,
    suffix: "+",
    label: "Early Adopters",
    description: "On our waitlist",
  },
  {
    value: 99.9,
    suffix: "%",
    decimals: 1,
    label: "Uptime",
    description: "Enterprise reliability",
  },
  {
    value: 0,
    prefix: "$",
    label: "Cost",
    description: "Forever free",
  },
];

export function StatsSection() {
  return (
    <section className="relative w-full py-20 md:py-28 overflow-hidden">
      {/* Background gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to right, rgba(6, 182, 212, 0.05), rgba(139, 92, 246, 0.05))",
        }}
      />

      {/* Top border glow */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/50 to-transparent" />

      {/* Bottom border glow */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent-violet/50 to-transparent" />

      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        <StaggerContainer
          className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4"
          staggerDelay={0.1}
        >
          {stats.map((stat, index) => (
            <StaggerItem key={index}>
              <div className="text-center p-6 md:p-8 rounded-2xl bg-bg-surface/30 border border-white/5 transition-all duration-300 hover:border-accent-cyan/20 hover:bg-bg-surface/50">
                <div className="text-4xl md:text-5xl font-bold gradient-text-cyan mb-2">
                  <CountUp
                    end={stat.value}
                    prefix={stat.prefix}
                    suffix={stat.suffix}
                    decimals={stat.decimals}
                    duration={2}
                  />
                </div>
                <div className="text-lg font-semibold text-white mb-1">
                  {stat.label}
                </div>
                <div className="text-sm text-zinc-500">{stat.description}</div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
