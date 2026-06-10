"use client";

import {
  Sparkles,
  RefreshCw,
  Bell,
  ShieldCheck,
  Search,
  BarChart3,
} from "lucide-react";
import { T, useGT } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { TextReveal } from "../animations/TextReveal";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { FeatureCard } from "../ui/FeatureCard";

const capabilities = [
  {
    icon: <Sparkles className="h-6 w-6" />,
    title: "AI-Powered App Discovery",
    description: "OpenAI integration automatically finds Winget IDs when standard search fails.",
    features: ["Smart matching", "Reduced manual work", "Higher accuracy"],
  },
  {
    icon: <RefreshCw className="h-6 w-6" />,
    title: "Automated Update Management",
    description: "Configure update policies with auto_update, notify, ignore, or pin_version modes.",
    features: ["Circuit breakers", "Rate limiting", "Update history"],
  },
  {
    icon: <Bell className="h-6 w-6" />,
    title: "Multi-Channel Notifications",
    description: "Email and webhook notifications for Slack, Teams, Discord, and custom endpoints.",
    features: ["Real-time alerts", "Deployment status", "Update availability"],
  },
  {
    icon: <ShieldCheck className="h-6 w-6" />,
    title: "Pre-Upload Permission Check",
    description: "Verify all required permissions before starting deployment. Tests actual API access to avoid mid-process failures.",
    features: ["Early detection", "Real API testing", "Clear error messages"],
  },
  {
    icon: <Search className="h-6 w-6" />,
    title: "Partial & Fuzzy Search",
    description: "Search with partial terms - type 'chr' to find 'Chrome' and similar apps instantly.",
    features: ["Faster discovery", "Flexible matching", "Better UX"],
  },
  {
    icon: <BarChart3 className="h-6 w-6" />,
    title: "Real-time Statistics",
    description: "Track deployment metrics, success rates, and usage statistics in a live dashboard.",
    features: ["Live metrics", "Deployment history", "Performance insights"],
  },
];

export function CapabilitiesSection() {
  const t = useGT();

  return (
    <section
      id="features"
      className="relative w-full py-20 md:py-28 scroll-mt-20 md:scroll-mt-24 overflow-hidden"
    >
      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        {/* Section header */}
        <div className="text-center mb-12 md:mb-16 space-y-4">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              <T id="features.badge">Capabilities</T>
            </span>
          </FadeIn>
          <TextReveal
            as="h2"
            text={t("Winget-Powered Features Built for IT Teams")}
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary"
            delay={0.1}
            staggerDelay={0.04}
          />
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-text-secondary">
              <T id="features.subheading">Powerful Winget-to-Intune automation features that streamline your app deployment from discovery to delivery</T>
            </p>
          </FadeIn>
        </div>

        {/* Capability cards - 2 cols on mobile, 3 cols on desktop */}
        <StaggerContainer
          className="grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          staggerDelay={0.1}
        >
          {capabilities.map((cap, index) => (
            <StaggerItem key={index}>
              <FeatureCard
                icon={cap.icon}
                title={<T>{cap.title}</T>}
                description={<T>{cap.description}</T>}
                features={cap.features.map((f, i) => <T key={i}>{f}</T>)}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

// Keep backward-compatible export
export { CapabilitiesSection as FeaturesSection };
