"use client";

import { Package, Upload, Cloud } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { TextReveal } from "../animations/TextReveal";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { FeatureCard } from "../ui/FeatureCard";

const features = [
  {
    icon: <Package className="h-6 w-6" />,
    title: "Winget Integration",
    description:
      "Seamlessly package applications using Winget for easy deployment to your Intune environment.",
    features: ["Access to 10,000+ apps", "Automatic updates", "Version control"],
  },
  {
    icon: <Upload className="h-6 w-6" />,
    title: "Automated Uploads",
    description:
      "Automatically upload packaged applications to your Intune environment with just a few clicks.",
    features: ["Batch processing", "Error handling", "Progress tracking"],
  },
  {
    icon: <Cloud className="h-6 w-6" />,
    title: "Cloud-Ready",
    description:
      "Designed to work seamlessly with Microsoft's cloud infrastructure and modern workplace.",
    features: ["Entra ID integration", "Secure authentication", "Real-time sync"],
  },
];

export function FeaturesSection() {
  return (
    <section
      id="features"
      className="relative w-full py-24 md:py-32 overflow-hidden"
    >
      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        {/* Section header */}
        <div className="text-center mb-16 md:mb-20 space-y-4">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              Features
            </span>
          </FadeIn>
          <TextReveal
            as="h2"
            text="Everything You Need"
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900"
            delay={0.1}
            staggerDelay={0.04}
          />
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-stone-600">
              Powerful tools to streamline your Intune app deployment process
            </p>
          </FadeIn>
        </div>

        {/* Feature cards */}
        <StaggerContainer
          className="grid gap-6 md:gap-8 sm:grid-cols-2 lg:grid-cols-3"
          staggerDelay={0.15}
        >
          {features.map((feature, index) => (
            <StaggerItem key={index}>
              <FeatureCard
                icon={feature.icon}
                title={feature.title}
                description={feature.description}
                features={feature.features}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}
