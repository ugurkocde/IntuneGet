"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { GradientOrb } from "../ui/GradientOrb";
import { GridBackground } from "../ui/GridBackground";
import { Badge } from "../ui/Badge";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "What is IntuneGet and how does it work?",
    answer:
      "IntuneGet is a powerful tool that bridges the gap between Winget and Microsoft Intune. It automatically packages applications from the Winget repository and uploads them to your Intune environment, streamlining your app deployment process with just a few clicks.",
  },
  {
    question: "Is IntuneGet really free and open source?",
    answer:
      "Yes! IntuneGet is completely free and open source under the MIT license. You can use it without any cost, modify it to fit your needs, and contribute to its development. We believe in making IT management tools accessible to everyone.",
  },
  {
    question: "Which applications are supported?",
    answer:
      "IntuneGet supports over 10,000+ applications available in the Winget repository. This includes popular software like browsers, productivity tools, development environments, and enterprise applications. The list is constantly growing as new apps are added to Winget.",
  },
  {
    question: "Do I need special permissions to use IntuneGet?",
    answer:
      "You'll need appropriate permissions in your Entra ID and Intune environment to upload and manage applications. Typically, this requires Intune Administrator or Application Administrator roles. We provide detailed documentation on the required permissions.",
  },
  {
    question: "How secure is the deployment process?",
    answer:
      "Security is our top priority. IntuneGet uses Microsoft's official APIs and follows enterprise security best practices. All communications are encrypted, and we never store your credentials. The tool integrates seamlessly with Entra ID authentication.",
  },
  {
    question: "Can I self-host IntuneGet?",
    answer:
      "Yes! IntuneGet is fully open source and can be self-hosted on your own infrastructure. Check out our documentation for detailed setup instructions, or use our hosted service for a hassle-free experience.",
  },
];

export function FAQSectionAnimated() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="relative w-full py-24 md:py-32 overflow-hidden">
      {/* Background */}
      <GridBackground variant="dots" opacity={0.2} className="absolute inset-0" />

      {/* Gradient orbs */}
      <GradientOrb
        color="cyan"
        size="lg"
        className="left-0 top-1/4"
        intensity="low"
      />
      <GradientOrb
        color="violet"
        size="md"
        className="right-0 bottom-1/4"
        intensity="low"
      />

      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        {/* Section header */}
        <div className="text-center mb-12 md:mb-16">
          <FadeIn>
            <Badge
              icon={<HelpCircle className="h-3.5 w-3.5" />}
              variant="cyan"
              className="mb-6"
            >
              FAQ
            </Badge>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h2 className="text-display-md text-white mb-4">
              Everything You Need to Know
            </h2>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="text-lg text-zinc-400 max-w-2xl mx-auto">
              Get answers to the most common questions about IntuneGet and how
              it can transform your app deployment workflow.
            </p>
          </FadeIn>
        </div>

        {/* FAQ items */}
        <StaggerContainer className="space-y-4" staggerDelay={0.1}>
          {faqs.map((faq, index) => (
            <StaggerItem key={index}>
              <div
                className={cn(
                  "rounded-2xl border transition-all duration-300",
                  "bg-bg-surface/50 backdrop-blur-sm",
                  openIndex === index
                    ? "border-accent-cyan/30 shadow-[0_0_30px_rgba(6,182,212,0.1)]"
                    : "border-white/5 hover:border-white/10"
                )}
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className="w-full px-6 py-5 text-left flex items-center justify-between gap-4"
                >
                  <h3 className="text-lg font-semibold text-white pr-4">
                    {faq.question}
                  </h3>
                  <motion.div
                    className="flex-shrink-0 text-zinc-400"
                    animate={{
                      rotate: openIndex === index ? 180 : 0,
                    }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : 0.2,
                    }}
                  >
                    <ChevronDown className="h-5 w-5" />
                  </motion.div>
                </button>

                <AnimatePresence initial={false}>
                  {openIndex === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: shouldReduceMotion ? 0 : 0.3,
                        ease: [0.25, 0.46, 0.45, 0.94],
                      }}
                    >
                      <div className="px-6 pb-5">
                        <div className="h-px bg-gradient-to-r from-transparent via-accent-cyan/20 to-transparent mb-4" />
                        <p className="text-zinc-400 leading-relaxed">
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
      </div>
    </section>
  );
}
