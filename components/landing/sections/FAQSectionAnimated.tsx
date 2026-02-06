"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { Badge } from "../ui/Badge";
import { cn } from "@/lib/utils";
import { faqData as faqs } from "@/lib/data/faq-data";
import { springPresets } from "@/lib/animations/variants";

export function FAQSectionAnimated() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="relative w-full py-24 md:py-32 overflow-hidden">
      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        {/* Section header - StaggerContainer for cascaded reveal */}
        <StaggerContainer className="text-center mb-12 md:mb-16" staggerDelay={0.1}>
          <StaggerItem>
            <Badge
              icon={<HelpCircle className="h-3.5 w-3.5" />}
              variant="cyan"
              className="mb-6"
            >
              FAQ
            </Badge>
          </StaggerItem>
          <StaggerItem>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-stone-900 mb-4">
              Everything You Need to Know
            </h2>
          </StaggerItem>
          <StaggerItem>
            <p className="text-lg text-stone-600 max-w-2xl mx-auto">
              Get answers to the most common questions about IntuneGet and how
              it can transform your app deployment workflow.
            </p>
          </StaggerItem>
        </StaggerContainer>

        {/* FAQ items */}
        <StaggerContainer className="space-y-4" staggerDelay={0.1}>
          {faqs.map((faq, index) => (
            <StaggerItem key={index}>
              <div
                className={cn(
                  "rounded-2xl border transition-all duration-300",
                  "bg-white shadow-card",
                  openIndex === index
                    ? "border-accent-cyan/30 shadow-card-hover"
                    : "border-stone-200/60 hover:border-stone-300/60"
                )}
              >
                <motion.button
                  onClick={() => toggleFAQ(index)}
                  aria-expanded={openIndex === index}
                  aria-controls={`faq-answer-animated-${index}`}
                  className="w-full px-6 py-5 text-left flex items-center justify-between gap-4 rounded-2xl hover:bg-stone-50/50 transition-colors"
                  whileTap={shouldReduceMotion ? {} : { scale: 0.995 }}
                >
                  <h3 id={`faq-question-animated-${index}`} className="text-base sm:text-lg font-semibold text-stone-900 pr-4">
                    {faq.question}
                  </h3>
                  <motion.div
                    className="flex-shrink-0 text-stone-400"
                    animate={{
                      rotate: openIndex === index ? 180 : 0,
                    }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.2,
                    }}
                  >
                    <ChevronDown className="h-5 w-5" />
                  </motion.div>
                </motion.button>

                <AnimatePresence initial={false}>
                  {openIndex === index && (
                    <motion.div
                      id={`faq-answer-animated-${index}`}
                      role="region"
                      aria-labelledby={`faq-question-animated-${index}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: shouldReduceMotion ? 0 : 0.3,
                        ease: [0.25, 0.46, 0.45, 0.94],
                      }}
                    >
                      <div className="px-6 pb-5">
                        <div className="h-px bg-gradient-to-r from-transparent via-stone-200 to-transparent mb-4" />
                        <p className="text-stone-600 leading-relaxed">
                          {faq.answer}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        {/* Still have questions? */}
        <FadeIn delay={0.5}>
          <div className="mt-10 md:mt-12 text-center">
            <p className="text-stone-600 mb-4">Still have questions?</p>
            <motion.a
              href="https://github.com/ugurkocde/IntuneGet/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-stone-700 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 hover:border-stone-300 transition-all duration-300 shadow-soft"
              whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
              whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
              transition={springPresets.snappy}
            >
              <HelpCircle className="w-4 h-4 text-accent-cyan" />
              Open a GitHub Issue
            </motion.a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
