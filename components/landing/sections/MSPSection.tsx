"use client";

import Link from "next/link";
import { T } from "gt-next";
import {
  ArrowRight,
  Building2,
  Layers,
  Lock,
  ScrollText,
  Users,
} from "lucide-react";
import { FadeIn } from "../animations/FadeIn";

const features = [
  {
    icon: Building2,
    title: "Multi-tenant workspace",
    description:
      "Manage all of your client tenants from a single interface instead of switching accounts.",
  },
  {
    icon: Layers,
    title: "Batch deployment",
    description:
      "Deploy one app across multiple client tenants simultaneously with configurable concurrency.",
  },
  {
    icon: Lock,
    title: "Tenant isolation",
    description:
      "Each client's data and deployments remain completely separate from every other tenant.",
  },
  {
    icon: Users,
    title: "Role-based team access",
    description:
      "Invite team members and assign Owner, Admin, Operator, or Viewer roles per workspace.",
  },
  {
    icon: ScrollText,
    title: "Audit logging",
    description:
      "Every action is recorded with IP and user agent tracking in a dedicated log viewer.",
  },
];

export function MSPSection() {
  return (
    <section className="relative w-full py-20 md:py-28 overflow-hidden">
      <div className="container relative px-4 md:px-6 mx-auto max-w-6xl">
        {/* Section header */}
        <div className="text-center mb-12 md:mb-16 space-y-4">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              <T id="msp.badge">For MSPs</T>
            </span>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary">
              <T id="msp.heading">Built for Managed Service Providers</T>
            </h2>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-text-secondary">
              <T id="msp.subheading">
                Run app deployments for every client tenant from one place,
                with the guardrails your team needs.
              </T>
            </p>
          </FadeIn>
        </div>

        {/* Feature cards */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <FadeIn key={feature.title} delay={0.2 + index * 0.08}>
              <div className="h-full p-6 rounded-2xl bg-bg-elevated border border-overlay/10 hover:border-accent-cyan/20 shadow-card hover:shadow-card-hover transition-all duration-300">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-cyan/10">
                  <feature.icon className="h-5 w-5 text-accent-cyan" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-text-primary">
                  <T>{feature.title}</T>
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary">
                  <T>{feature.description}</T>
                </p>
              </div>
            </FadeIn>
          ))}
        </div>

        {/* CTA link */}
        <FadeIn delay={0.5}>
          <div className="text-center mt-12">
            <Link
              href="/docs/msp"
              className="inline-flex items-center gap-2 text-accent-cyan hover:text-accent-cyan-dim font-medium transition-colors"
            >
              <T id="msp.cta">Explore MSP features</T>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
