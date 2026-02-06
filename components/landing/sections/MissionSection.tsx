"use client";

import { Heart, Target, Users } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { TextReveal } from "../animations/TextReveal";
import { SlideIn } from "../animations/SlideIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { motion, useReducedMotion } from "framer-motion";
import { springPresets } from "@/lib/animations/variants";

const values = [
  {
    icon: Target,
    title: "Built for IT Pros",
    description:
      "We understand the daily grind of managing enterprise deployments. IntuneGet was born from real frustration with repetitive packaging tasks.",
  },
  {
    icon: Heart,
    title: "Free Forever",
    description:
      "We believe great tools should be accessible to everyone. No freemium tricks, no surprise upgrades - just a tool that works.",
  },
  {
    icon: Users,
    title: "Community Driven",
    description:
      "Open source means you're never locked in. Contribute, customize, or self-host. The community shapes the roadmap.",
  },
];

export function MissionSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative w-full py-24 md:py-32 overflow-hidden bg-white">
      <div className="container relative px-4 md:px-6 mx-auto max-w-5xl">
        {/* Mission statement */}
        <div className="text-center mb-16 md:mb-20">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              Our Mission
            </span>
          </FadeIn>
          <TextReveal
            as="h2"
            text="We Believe IT Teams Shouldn't Waste Hours on Repetitive Packaging"
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900 mb-6"
            delay={0.1}
            staggerDelay={0.035}
          />
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-3xl text-lg md:text-xl text-stone-600 leading-relaxed">
              IntuneGet started as a personal project to solve a real problem: spending entire Fridays
              packaging apps that should take minutes. Now it&apos;s used by IT teams at organizations
              worldwide, helping them focus on what actually matters - keeping their organizations
              running smoothly.
            </p>
          </FadeIn>
        </div>

        {/* Values grid - 5B: Staggered reveal + hover */}
        <StaggerContainer
          className="grid md:grid-cols-3 gap-6 md:gap-8"
          staggerDelay={0.15}
        >
          {values.map((value) => (
            <StaggerItem key={value.title}>
              <motion.div
                className="p-6 md:p-8 rounded-2xl bg-white border border-stone-200/60 shadow-card hover:shadow-card-hover transition-shadow duration-300"
                whileHover={
                  shouldReduceMotion
                    ? {}
                    : { y: -6, transition: springPresets.snappy }
                }
              >
                <div className="w-12 h-12 rounded-xl bg-accent-cyan/10 flex items-center justify-center mb-4">
                  <value.icon className="w-6 h-6 text-accent-cyan" />
                </div>
                <h3 className="text-lg font-semibold text-stone-900 mb-2">
                  {value.title}
                </h3>
                <p className="text-stone-600 leading-relaxed">
                  {value.description}
                </p>
              </motion.div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        {/* Founder note - 5B: SlideIn */}
        <SlideIn direction="up" distance={30} duration={0.7} delay={0.2}>
          <div className="mt-12 md:mt-16 p-6 md:p-8 rounded-2xl bg-stone-50 border border-stone-200/60">
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent-cyan to-accent-violet flex items-center justify-center text-white font-bold text-lg">
                  UK
                </div>
              </div>
              <div>
                <p className="text-stone-700 leading-relaxed mb-2">
                  &ldquo;I built IntuneGet because I was tired of spending my Fridays packaging apps instead of
                  solving real problems. If this tool saves you even one afternoon, it&apos;s done its job.&rdquo;
                </p>
                <p className="text-sm text-stone-500">
                  <span className="font-medium text-stone-700">Ugur Koc</span> - Creator of IntuneGet
                </p>
              </div>
            </div>
          </div>
        </SlideIn>
      </div>
    </section>
  );
}
