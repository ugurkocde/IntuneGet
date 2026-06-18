"use client";

import { useState, type ReactNode } from "react";
import { T } from "gt-next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { Badge } from "../ui/Badge";
import { cn } from "@/lib/utils";
import { springPresets } from "@/lib/animations/variants";

interface FAQItem {
  question: ReactNode;
  answer: ReactNode;
}

const faqItems: FAQItem[] = [
  {
    question: <T>What is IntuneGet and how does it work?</T>,
    answer: <T>IntuneGet is the leading free, open-source tool for deploying Winget applications to Microsoft Intune. It automatically packages applications from the Winget repository (10,000+ apps) and uploads them to your Intune environment, streamlining your app deployment process with just a few clicks. No scripting or IntuneWin packaging required.</T>,
  },
  {
    question: <T>Is IntuneGet really 100% free?</T>,
    answer: <T>Yes! IntuneGet is completely free and open source under the AGPL-3.0 license. There are no hidden fees, no premium tiers, and no credit card required. You can use all features without any cost, modify it to fit your needs, and contribute to its development.</T>,
  },
  {
    question: <T>Why is IntuneGet free?</T>,
    answer: <T>IntuneGet is free with no seat limits because we believe every IT team deserves access to great deployment tools. IntuneGet gives you access to 10,000+ Winget packages, is fully open source under the AGPL-3.0 license, and supports self-hosting. No vendor lock-in, no surprise bills.</T>,
  },
  {
    question: <T>How long does setup take?</T>,
    answer: <T>Most users are up and running in under 5 minutes. Simply sign in with your Microsoft account, grant the necessary permissions, and you're ready to start deploying apps. Our step-by-step onboarding guides you through the entire process.</T>,
  },
  {
    question: <T>Where is my data stored?</T>,
    answer: <T>On the hosted version (intuneget.com), data is stored in the European Union, in Supabase&apos;s Frankfurt, Germany region (eu-central-1). We only keep the operational metadata needed to run the service, such as your account email, deployment history, app catalog, and team settings. We never store your app installers or your Intune credentials: authentication uses Microsoft Entra ID, access tokens stay in your browser, and packaged apps are uploaded directly to your own Intune tenant. The web app is served over an encrypted (TLS) connection via Vercel&apos;s global edge network, and packaging runs on temporary GitHub-hosted runners. If you need data to stay entirely on your own infrastructure or in a specific region, IntuneGet is open source and can be self-hosted with an embedded SQLite database.</T>,
  },
  {
    question: <T>Which applications are supported?</T>,
    answer: <T>IntuneGet supports over 10,000+ applications available in the Winget repository. This includes popular software like browsers, productivity tools, development environments, and enterprise applications. The list is constantly growing as new apps are added to Winget.</T>,
  },
  {
    question: <T>Do I need special permissions to use IntuneGet?</T>,
    answer: <T>You'll need appropriate permissions in your Entra ID and Intune environment to upload and manage applications. Typically, this requires Intune Administrator or Application Administrator roles. We provide detailed documentation on the required permissions.</T>,
  },
  {
    question: <T>Can I assign the Owner role to a team member?</T>,
    answer: <T>The Owner role is held by the person who creates the MSP organization and cannot be reassigned or granted to other members, which protects the organization from an accidental takeover. When you invite or edit members, the highest role you can assign is Admin. An Admin has every permission except changing member roles and deleting the organization, which remain exclusive to the Owner. This is the same in the hosted and self-hosted versions; there is no separate step or upgrade required to unlock Owner. If ownership of an organization needs to change, contact support.</T>,
  },
  {
    question: <T>What support is available?</T>,
    answer: <T>As an open source project, support is provided through our GitHub community. You can file issues and get help from other users. We also have comprehensive documentation covering common use cases and troubleshooting.</T>,
  },
  {
    question: <T>Can I self-host IntuneGet?</T>,
    answer: <T>Yes! IntuneGet is fully open source under the AGPL-3.0 license and can be self-hosted on your own infrastructure using Docker. It uses an embedded SQLite database with zero external dependencies. Check out our documentation for detailed setup instructions, or use our hosted service for a hassle-free experience.</T>,
  },
  {
    question: <T>How do I deploy Winget apps to Intune without scripting?</T>,
    answer: <T>IntuneGet eliminates the need for scripting entirely. Simply search for an app from the 10,000+ Winget repository, configure your deployment settings with a visual interface, and click deploy. IntuneGet handles all the packaging, IntuneWin conversion, and upload to your Intune tenant automatically.</T>,
  },
];

export function FAQSectionAnimated() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="relative w-full py-20 md:py-28 overflow-hidden">
      <div className="container relative px-4 md:px-6 mx-auto max-w-4xl">
        {/* Section header */}
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
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary mb-4">
              <T id="faq.heading">Everything You Need to Know</T>
            </h2>
          </StaggerItem>
          <StaggerItem>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              <T id="faq.subheading">Get answers to the most common questions about IntuneGet and how it can transform your app deployment workflow.</T>
            </p>
          </StaggerItem>
        </StaggerContainer>

        {/* FAQ items */}
        <StaggerContainer className="space-y-4" staggerDelay={0.1}>
          {faqItems.map((faq, index) => (
            <StaggerItem key={index}>
              <div
                className={cn(
                  "rounded-2xl border transition-all duration-300",
                  "bg-bg-elevated shadow-card",
                  openIndex === index
                    ? "border-accent-cyan/30 shadow-card-hover"
                    : "border-overlay/10 hover:border-overlay/15"
                )}
              >
                <motion.button
                  onClick={() => toggleFAQ(index)}
                  aria-expanded={openIndex === index}
                  aria-controls={`faq-answer-animated-${index}`}
                  className="w-full px-6 py-5 text-left flex items-center justify-between gap-4 rounded-2xl hover:bg-overlay/[0.03] transition-colors"
                  whileTap={shouldReduceMotion ? {} : { scale: 0.995 }}
                >
                  <h3 id={`faq-question-animated-${index}`} className="text-base sm:text-lg font-semibold text-text-primary pr-4">
                    {faq.question}
                  </h3>
                  <motion.div
                    className="flex-shrink-0 text-text-muted"
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
                        <div className="h-px bg-gradient-to-r from-transparent via-overlay/15 to-transparent mb-4" />
                        <p className="text-text-secondary leading-relaxed">
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
            <p className="text-text-secondary mb-4"><T id="faq.still-questions">Still have questions?</T></p>
            <motion.a
              href="https://github.com/ugurkocde/IntuneGet/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] hover:border-overlay/15 transition-all duration-300 shadow-soft"
              whileHover={shouldReduceMotion ? {} : { scale: 1.02 }}
              whileTap={shouldReduceMotion ? {} : { scale: 0.97 }}
              transition={springPresets.snappy}
            >
              <HelpCircle className="w-4 h-4 text-accent-cyan" />
              <T id="faq.open-issue">Open a GitHub Issue</T>
            </motion.a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
