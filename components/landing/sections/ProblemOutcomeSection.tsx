"use client";

import { motion, useReducedMotion } from "framer-motion";
import { FadeIn } from "../animations/FadeIn";
import { X, Check, Clock, Code, RefreshCw, AlertTriangle, Zap, Layers, Shield, TrendingUp } from "lucide-react";

const problems = [
  { icon: Clock, text: "Manual app packaging takes hours" },
  { icon: Code, text: "Scripting expertise required" },
  { icon: RefreshCw, text: "Version management nightmare" },
  { icon: AlertTriangle, text: "Deployment failures delay projects" },
];

const outcomes = [
  { icon: Zap, text: "Deploy any app in minutes" },
  { icon: Layers, text: "Zero scripting required" },
  { icon: RefreshCw, text: "Automatic version updates" },
  { icon: Shield, text: "99.9% deployment success rate" },
];

export function ProblemOutcomeSection() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <section className="relative w-full py-16 md:py-24 bg-stone-50">
      <div className="container relative px-4 md:px-6 mx-auto max-w-6xl">
        {/* Section header */}
        <FadeIn>
          <div className="text-center mb-12 md:mb-16 space-y-4">
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase">
              Before & After
            </span>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900">
              Transform Your Deployment Workflow
            </h2>
            <p className="mx-auto max-w-2xl text-lg text-stone-600">
              See how IntuneGet eliminates the complexity from enterprise app deployment
            </p>
          </div>
        </FadeIn>

        {/* Before/After comparison */}
        <div className="grid md:grid-cols-2 gap-6 md:gap-8">
          {/* The Old Way */}
          <FadeIn delay={0.1}>
            <motion.div
              className="relative bg-white rounded-2xl border border-stone-200 p-6 md:p-8 h-full"
              whileHover={shouldReduceMotion ? {} : { y: -4 }}
              transition={{ duration: 0.3 }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                  <X className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-stone-900">The Old Way</h3>
                  <p className="text-sm text-stone-500">Manual deployment process</p>
                </div>
              </div>

              {/* Pain points */}
              <div className="space-y-4">
                {problems.map((item, index) => (
                  <motion.div
                    key={item.text}
                    className="flex items-start gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.3,
                      delay: shouldReduceMotion ? 0 : 0.2 + index * 0.1,
                    }}
                  >
                    <item.icon className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                    <span className="text-stone-700">{item.text}</span>
                  </motion.div>
                ))}
              </div>

              {/* Time metric */}
              <div className="mt-6 pt-6 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-500">Average deployment time</span>
                  <span className="text-2xl font-bold text-red-500">8+ hours</span>
                </div>
              </div>
            </motion.div>
          </FadeIn>

          {/* The IntuneGet Way */}
          <FadeIn delay={0.2}>
            <motion.div
              className="relative bg-white rounded-2xl border-2 border-accent-cyan/20 p-6 md:p-8 h-full shadow-glow-cyan"
              whileHover={shouldReduceMotion ? {} : { y: -4 }}
              transition={{ duration: 0.3 }}
            >
              {/* Recommended badge */}
              <div className="absolute -top-3 right-6">
                <span className="px-3 py-1 bg-accent-cyan text-white text-xs font-semibold rounded-full">
                  Recommended
                </span>
              </div>

              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-accent-cyan/10 flex items-center justify-center">
                  <Check className="w-5 h-5 text-accent-cyan" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-stone-900">The IntuneGet Way</h3>
                  <p className="text-sm text-stone-500">Automated deployment</p>
                </div>
              </div>

              {/* Benefits */}
              <div className="space-y-4">
                {outcomes.map((item, index) => (
                  <motion.div
                    key={item.text}
                    className="flex items-start gap-3 p-3 rounded-lg bg-accent-cyan/5 border border-accent-cyan/20"
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.3,
                      delay: shouldReduceMotion ? 0 : 0.3 + index * 0.1,
                    }}
                  >
                    <item.icon className="w-5 h-5 text-accent-cyan mt-0.5 shrink-0" />
                    <span className="text-stone-700">{item.text}</span>
                  </motion.div>
                ))}
              </div>

              {/* Time metric */}
              <div className="mt-6 pt-6 border-t border-accent-cyan/10">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-500">Average deployment time</span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-accent-cyan">12 min</span>
                    <span className="flex items-center text-xs text-emerald-600 font-medium">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      40x faster
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </FadeIn>
        </div>

      </div>
    </section>
  );
}
