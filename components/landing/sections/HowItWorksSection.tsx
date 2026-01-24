"use client";

import { motion, useReducedMotion } from "framer-motion";
import { FadeIn } from "../animations/FadeIn";
import { GradientOrb } from "../ui/GradientOrb";
import { GridBackground } from "../ui/GridBackground";

const steps = [
  {
    number: "01",
    title: "Select Applications",
    description:
      "Choose the applications you want to deploy from Winget's extensive repository of 10,000+ packages.",
  },
  {
    number: "02",
    title: "Package with Winget",
    description:
      "Our tool automatically packages your selected applications using Winget, handling all the complexity.",
  },
  {
    number: "03",
    title: "Upload to Intune",
    description:
      "Packaged applications are seamlessly uploaded to your Intune environment, ready for deployment.",
  },
];

export function HowItWorksSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section
      id="how-it-works"
      className="relative w-full py-24 md:py-32 overflow-hidden"
    >
      {/* Background */}
      <GridBackground variant="lines" opacity={0.15} className="absolute inset-0" />

      {/* Gradient background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, transparent 0%, rgba(6, 182, 212, 0.03) 50%, transparent 100%)",
        }}
      />

      {/* Gradient orbs */}
      <GradientOrb
        color="cyan"
        size="md"
        className="left-0 top-1/3"
        intensity="low"
      />
      <GradientOrb
        color="violet"
        size="md"
        className="right-0 bottom-1/3"
        intensity="low"
      />

      <div className="container relative px-4 md:px-6 mx-auto max-w-7xl">
        {/* Section header */}
        <div className="text-center mb-16 md:mb-20 space-y-4">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              Process
            </span>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h2 className="text-display-md text-white">
              How It Works
            </h2>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-zinc-400">
              Three simple steps to streamline your application deployment
            </p>
          </FadeIn>
        </div>

        {/* Timeline */}
        <div className="relative max-w-4xl mx-auto">
          {/* Connecting line */}
          <div className="absolute left-8 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-accent-cyan/50 via-accent-violet/50 to-transparent hidden md:block" />

          {/* Steps */}
          <div className="space-y-12 md:space-y-24">
            {steps.map((step, index) => (
              <FadeIn
                key={index}
                delay={0.2 + index * 0.15}
                direction={index % 2 === 0 ? "left" : "right"}
              >
                <div
                  className={`relative flex flex-col md:flex-row items-start md:items-center gap-6 md:gap-12 ${
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
                      {/* Glow effect */}
                      <div className="absolute inset-0 rounded-full bg-accent-cyan/30 blur-xl" />
                      <div className="relative w-16 h-16 rounded-full bg-bg-surface border border-accent-cyan/30 flex items-center justify-center">
                        <span className="font-mono text-xl font-bold text-accent-cyan">
                          {step.number}
                        </span>
                      </div>
                    </div>
                  </motion.div>

                  {/* Content */}
                  <div
                    className={`flex-1 ${
                      index % 2 === 0 ? "md:text-left" : "md:text-right"
                    }`}
                  >
                    <div
                      className={`p-6 md:p-8 rounded-2xl bg-bg-surface/50 border border-white/5 backdrop-blur-sm transition-all duration-300 hover:border-accent-cyan/20 hover:bg-bg-elevated/50`}
                    >
                      <h3 className="text-xl font-semibold text-white mb-3">
                        {step.title}
                      </h3>
                      <p className="text-zinc-400 leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
