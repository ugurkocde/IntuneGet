"use client";

import { useRef } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { T } from "gt-next";
import { Clock, ArrowRight } from "lucide-react";
import Link from "next/link";
import { FadeIn } from "../animations/FadeIn";

const steps = [
  {
    number: "01",
    title: "Select Applications",
    timeEstimate: "30 seconds",
    description: "Choose the applications you want to deploy from the full Winget catalog.",
  },
  {
    number: "02",
    title: "Package with Winget",
    timeEstimate: "2-3 minutes",
    description: "IntuneGet automatically packages your selected applications using Winget into the .intunewin format, handling all the complexity.",
  },
  {
    number: "03",
    title: "Upload to Intune",
    timeEstimate: "About 1 minute",
    description: "Packaged applications are seamlessly uploaded to your Microsoft Intune environment, ready for deployment to your managed devices.",
  },
];

export function HowItWorksSection() {
  const shouldReduceMotion = useReducedMotion();
  const timelineRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: timelineRef,
    offset: ["start end", "end center"],
  });
  const lineScaleY = useTransform(scrollYProgress, [0, 0.6], [0, 1]);

  return (
    <section
      id="how-it-works"
      className="relative w-full py-20 md:py-28 scroll-mt-20 md:scroll-mt-24 overflow-hidden bg-bg-elevated"
    >
      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        {/* Section header */}
        <div className="mb-12 md:mb-16 space-y-4">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              <T id="howitworks.badge">Process</T>
            </span>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary">
              <T id="howitworks.heading">How Winget-to-Intune Deployment Works</T>
            </h2>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="max-w-2xl text-lg text-text-secondary">
              <T id="howitworks.subheading">Three simple steps to deploy your first app in about 5 minutes</T>
            </p>
          </FadeIn>
        </div>

        {/* Timeline */}
        <div ref={timelineRef} className="relative max-w-4xl mx-auto">
          <div className="relative">
            {/* Connecting line - scroll-animated */}
            <div className="absolute left-6 md:left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2">
              <div className="absolute inset-0 bg-overlay/10" />
              <motion.div
                className="absolute top-0 left-0 right-0 origin-top bg-gradient-to-b from-accent-cyan/40 via-accent-violet/40 to-accent-cyan/20"
                style={{
                  scaleY: shouldReduceMotion ? 1 : lineScaleY,
                  height: "100%",
                }}
              />
            </div>

            {/* Steps */}
            <div className="space-y-10 md:space-y-16">
            {steps.map((step, index) => (
              <FadeIn
                key={index}
                delay={0.2 + index * 0.15}
                direction={index % 2 === 0 ? "left" : "right"}
              >
                <div
                  className={`relative flex flex-row items-start md:items-center gap-4 md:gap-12 ${
                    index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                  }`}
                >
                  {/* Number circle */}
                  <motion.div
                    className="relative z-10 flex-shrink-0"
                    whileHover={
                      shouldReduceMotion
                        ? {}
                        : {
                            scale: 1.1,
                            transition: { duration: 0.2 },
                          }
                    }
                  >
                    <div className="relative">
                      <div className="relative w-12 h-12 md:w-16 md:h-16 rounded-full bg-bg-elevated border-2 border-accent-cyan/30 flex items-center justify-center shadow-soft-lg">
                        <span className="font-mono text-base md:text-xl font-bold text-accent-cyan">
                          {step.number}
                        </span>
                      </div>
                    </div>
                  </motion.div>

                  {/* Content */}
                  <div
                    className={`flex-1 min-w-0 ${
                      index % 2 === 0 ? "md:text-left" : "md:text-right"
                    }`}
                  >
                    <div
                      className="p-6 md:p-8 rounded-2xl bg-bg-elevated border border-overlay/10 hover:border-accent-cyan/20 shadow-card hover:shadow-card-hover transition-all duration-300"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h3 className="text-xl font-semibold text-text-primary">
                          <T>{step.title}</T>
                        </h3>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-accent-cyan bg-accent-cyan/10 px-2.5 py-1 rounded-full">
                          <Clock className="w-3 h-3" />
                          <T>{step.timeEstimate}</T>
                        </span>
                      </div>
                      <p className="text-text-secondary leading-relaxed">
                        <T>{step.description}</T>
                      </p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
            </div>
          </div>

          {/* Internal link to pillar blog post */}
          <FadeIn delay={0.5}>
            <div className="text-center mt-12">
              <Link
                href="/blog/deploy-winget-apps-to-intune"
                className="inline-flex items-center gap-2 text-accent-cyan hover:text-accent-cyan-dim font-medium transition-colors"
              >
                <T id="howitworks.guide-link">Read our complete guide to deploying Winget apps to Intune</T>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}
