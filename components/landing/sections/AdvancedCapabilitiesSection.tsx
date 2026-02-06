"use client";

import {
  Sparkles,
  RefreshCw,
  Bell,
  ShieldCheck,
  Search,
  BarChart3,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { FadeIn } from "../animations/FadeIn";
import { SlideIn } from "../animations/SlideIn";
import { CapabilityCard } from "../ui/CapabilityCard";
import { CategoryRow, CategoryRowItem } from "../ui/CategoryRow";
import { scaleIn } from "@/lib/animations/variants";

const intelligentAutomation = [
  {
    icon: <Sparkles className="h-5 w-5" />,
    title: "AI-Powered App Discovery",
    description:
      "OpenAI integration automatically finds Winget IDs when standard search fails.",
    features: ["Smart matching", "Reduced manual work", "Higher accuracy"],
  },
  {
    icon: <RefreshCw className="h-5 w-5" />,
    title: "Automated Update Management",
    description:
      "Configure update policies with auto_update, notify, ignore, or pin_version modes.",
    features: ["Circuit breakers", "Rate limiting", "Update history"],
  },
];

const enterpriseNotifications = [
  {
    icon: <Bell className="h-5 w-5" />,
    title: "Multi-Channel Notifications",
    description:
      "Email and webhook notifications for Slack, Teams, Discord, and custom endpoints.",
    features: ["Real-time alerts", "Deployment status", "Update availability"],
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: "Pre-Upload Permission Check",
    description:
      "Verify all required permissions before starting deployment. Tests actual API access, not just role membership, to avoid mid-process failures.",
    features: ["Early detection", "Real API testing", "Clear error messages"],
  },
];

const workflowOptimization = [
  {
    icon: <Search className="h-5 w-5" />,
    title: "Partial & Fuzzy Search",
    description:
      "Search with partial terms - type 'chr' to find 'Chrome' and similar apps instantly.",
    features: ["Faster discovery", "Flexible matching", "Better UX"],
  },
  {
    icon: <BarChart3 className="h-5 w-5" />,
    title: "Real-time Statistics",
    description:
      "Track deployment metrics, success rates, and usage statistics in a live dashboard.",
    features: ["Live metrics", "Deployment history", "Performance insights"],
  },
];

export function AdvancedCapabilitiesSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="advanced-capabilities"
      className="relative w-full py-20 md:py-28 overflow-hidden"
    >
      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        {/* Section header - ScaleIn tag + SlideIn headline */}
        <div className="text-center mb-14 md:mb-18 space-y-4">
          <motion.div
            initial={shouldReduceMotion ? { opacity: 0 } : "hidden"}
            whileInView={shouldReduceMotion ? { opacity: 1 } : "visible"}
            viewport={{ once: true, amount: 0.3 }}
            variants={shouldReduceMotion ? undefined : scaleIn}
            transition={shouldReduceMotion ? { duration: 0 } : undefined}
          >
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              Advanced Capabilities
            </span>
          </motion.div>
          <SlideIn direction="up" distance={30} duration={0.5} delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900">
              Enterprise-Grade Automation
            </h2>
          </SlideIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-stone-600">
              Powerful features built for IT teams managing deployments at scale
            </p>
          </FadeIn>
        </div>

        {/* Category rows */}
        <div className="space-y-12 md:space-y-16">
          {/* Intelligent Automation */}
          <CategoryRow title="Intelligent Automation" color="cyan" delay={0}>
            {intelligentAutomation.map((item, index) => (
              <CategoryRowItem key={index}>
                <CapabilityCard
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  features={item.features}
                  color="cyan"
                />
              </CategoryRowItem>
            ))}
          </CategoryRow>

          {/* Enterprise Notifications */}
          <CategoryRow title="Enterprise Notifications" color="violet" delay={0.1}>
            {enterpriseNotifications.map((item, index) => (
              <CategoryRowItem key={index}>
                <CapabilityCard
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  features={item.features}
                  color="violet"
                />
              </CategoryRowItem>
            ))}
          </CategoryRow>

          {/* Workflow Optimization */}
          <CategoryRow title="Workflow Optimization" color="gradient" delay={0.2}>
            {workflowOptimization.map((item, index) => (
              <CategoryRowItem key={index}>
                <CapabilityCard
                  icon={item.icon}
                  title={item.title}
                  description={item.description}
                  features={item.features}
                  color="gradient"
                />
              </CategoryRowItem>
            ))}
          </CategoryRow>
        </div>
      </div>
    </section>
  );
}
