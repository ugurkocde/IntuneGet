"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { T, useGT } from "gt-next";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Boxes,
  ChevronDown,
  CircleCheck,
  CloudUpload,
  Database,
  HelpCircle,
  LayoutGrid,
  Rocket,
  Search,
  Server,
  ShieldCheck,
} from "lucide-react";
import { FadeIn } from "../animations/FadeIn";
import { StaggerContainer, StaggerItem } from "../animations/StaggerContainer";
import { cn } from "@/lib/utils";
import { springPresets } from "@/lib/animations/variants";
import { faqData } from "@/lib/data/faq-data";

// Single source of truth: lib/data/faq-data.ts. Entries flagged
// visibleOnPage: false are SEO-only (still emitted in the homepage FAQPage
// JSON-LD via app/page.tsx) and are excluded from the visible list below.
const faqItems = faqData.filter((faq) => faq.visibleOnPage !== false);

type FAQCategory = "all" | NonNullable<(typeof faqItems)[number]["category"]>;

const categories = [
  { id: "all", label: "All questions", icon: LayoutGrid },
  { id: "getting-started", label: "Getting started", icon: Rocket },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "deployment", label: "Deployment", icon: CloudUpload },
  { id: "self-hosting", label: "Self-hosting", icon: Server },
] satisfies Array<{ id: FAQCategory; label: string; icon: typeof LayoutGrid }>;

const questionIcons = [ShieldCheck, Boxes, CloudUpload, Server, Database];

export function FAQSectionAnimated() {
  const [openQuestion, setOpenQuestion] = useState<string | null>(
    "What permissions does IntuneGet request?",
  );
  const [activeCategory, setActiveCategory] = useState<FAQCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const shouldReduceMotion = useReducedMotion();
  const t = useGT();

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();

    return faqItems.filter((faq) => {
      const matchesCategory =
        activeCategory === "all" || faq.category === activeCategory;
      const matchesQuery =
        !query ||
        faq.question.toLocaleLowerCase().includes(query) ||
        faq.answer.toLocaleLowerCase().includes(query);

      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, searchQuery]);

  const toggleFAQ = (question: string) => {
    setOpenQuestion(openQuestion === question ? null : question);
  };

  return (
    <section
      id="faq"
      className="relative w-full overflow-hidden py-20 scroll-mt-20 md:py-28 md:scroll-mt-24"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(0,174,239,0.08),transparent_34%)]" />
      <div className="container relative mx-auto max-w-7xl px-4 md:px-6">
        <div className="grid grid-cols-1 gap-x-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-x-12">
          <StaggerContainer
            className="mb-10 text-center lg:col-start-2 lg:text-left"
            staggerDelay={0.1}
          >
            <StaggerItem>
              <h2 className="text-3xl font-bold tracking-tight text-text-primary md:text-4xl lg:text-5xl">
                <T id="faq.heading">
                  Answers for the questions admins ask first.
                </T>
              </h2>
            </StaggerItem>
            <StaggerItem>
              <p className="mx-auto mt-4 max-w-2xl text-lg text-text-secondary lg:mx-0">
                <T id="faq.subheading">
                  Clear answers about permissions, packaging, deployment, and
                  hosting.
                </T>
              </p>
            </StaggerItem>
          </StaggerContainer>

          <FadeIn className="mb-6 lg:mb-0" delay={0.1}>
            <nav
              aria-label={t("FAQ categories")}
              className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-24 lg:flex-col lg:overflow-visible lg:border-r lg:border-overlay/10 lg:pb-0 lg:pr-7"
            >
              {categories.map((category) => {
                const Icon = category.icon;
                const isActive = activeCategory === category.id;

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveCategory(category.id)}
                    aria-pressed={isActive}
                    className={cn(
                      "group flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-colors lg:w-full lg:px-3 lg:text-base",
                      isActive
                        ? "bg-accent-cyan/10 text-accent-cyan"
                        : "text-text-secondary hover:bg-overlay/[0.04] hover:text-text-primary",
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <T>{category.label}</T>
                  </button>
                );
              })}
            </nav>
          </FadeIn>

          <div className="min-w-0">
            {/* Low amount: the card is taller than a phone viewport, so a
                higher threshold may never be crossed and the card stays
                invisible on mobile. */}
            <FadeIn amount={0.05}>
              <div className="rounded-3xl border border-overlay/10 bg-bg-elevated p-4 shadow-card sm:p-6">
                <label className="relative block">
                  <span className="sr-only">
                    <T>Search questions</T>
                  </span>
                  <Search
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("Search questions")}
                    className="h-14 w-full rounded-xl border border-overlay/15 bg-bg-primary pl-12 pr-4 text-base text-text-primary outline-none transition focus:border-accent-cyan/60 focus:ring-4 focus:ring-accent-cyan/10"
                  />
                </label>

                <div className="mt-5 space-y-3">
                  {filteredItems.map((faq, index) => {
                    const isOpen = openQuestion === faq.question;
                    const ItemIcon =
                      questionIcons[index % questionIcons.length];
                    const itemId = `faq-${faqItems.indexOf(faq)}`;

                    return (
                      // Each item animates itself on mount/scroll-in. A parent
                      // stagger variant with once:true leaves items remounted
                      // by category/search filtering stuck at opacity 0.
                      <motion.div
                        key={faq.question}
                        initial={
                          shouldReduceMotion ? false : { opacity: 0, y: 24 }
                        }
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.1 }}
                        transition={{
                          duration: 0.5,
                          delay: index * 0.05,
                          ease: [0.25, 0.46, 0.45, 0.94],
                        }}
                      >
                        <div
                          className={cn(
                            "overflow-hidden rounded-xl border transition-all duration-300",
                            isOpen
                              ? "border-accent-cyan/30 bg-accent-cyan/[0.035] shadow-soft"
                              : "border-overlay/10 bg-bg-primary hover:border-overlay/20",
                          )}
                        >
                          <h3 id={`${itemId}-question`}>
                            <motion.button
                              type="button"
                              onClick={() => toggleFAQ(faq.question)}
                              aria-expanded={isOpen}
                              aria-controls={`${itemId}-answer`}
                              className="flex w-full items-center gap-3 px-4 py-4 text-left sm:px-5"
                              whileTap={
                                shouldReduceMotion ? {} : { scale: 0.995 }
                              }
                            >
                              <ItemIcon
                                className={cn(
                                  "h-5 w-5 shrink-0",
                                  isOpen
                                    ? "text-accent-cyan"
                                    : "text-text-muted",
                                )}
                                aria-hidden="true"
                              />
                              <span className="flex-1 pr-2 text-base font-semibold text-text-primary sm:text-lg">
                                <T>{faq.question}</T>
                              </span>
                              <motion.span
                                className="shrink-0 text-text-muted"
                                animate={{ rotate: isOpen ? 180 : 0 }}
                                transition={{
                                  duration: shouldReduceMotion ? 0 : 0.2,
                                }}
                              >
                                <ChevronDown className="h-5 w-5" />
                              </motion.span>
                            </motion.button>
                          </h3>

                          <AnimatePresence initial={false}>
                            {isOpen && (
                              <motion.div
                                id={`${itemId}-answer`}
                                role="region"
                                aria-labelledby={`${itemId}-question`}
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{
                                  duration: shouldReduceMotion ? 0 : 0.3,
                                  ease: [0.25, 0.46, 0.45, 0.94],
                                }}
                              >
                                <div className="px-4 pb-5 pl-12 sm:px-5 sm:pl-12">
                                  <p className="max-w-3xl leading-relaxed text-text-secondary">
                                    <T>{faq.answer}</T>
                                  </p>
                                  {faq.linkHref && faq.linkLabel && (
                                    <Link
                                      href={faq.linkHref}
                                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-cyan hover:underline"
                                    >
                                      <T>{faq.linkLabel}</T>
                                      <ArrowRight
                                        className="h-4 w-4"
                                        aria-hidden="true"
                                      />
                                    </Link>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {filteredItems.length === 0 && (
                  <div className="py-14 text-center">
                    <HelpCircle className="mx-auto h-8 w-8 text-text-muted" />
                    <p className="mt-3 font-medium text-text-primary">
                      <T>No matching questions</T>
                    </p>
                    <p className="mt-1 text-sm text-text-secondary">
                      <T>Try a different search or category.</T>
                    </p>
                  </div>
                )}

                <div className="mt-5 flex flex-col items-start gap-3 border-t border-overlay/10 pt-5 sm:flex-row sm:items-center">
                  <CircleCheck
                    className="h-5 w-5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-text-secondary sm:text-base">
                    <T id="faq.still-questions">Still have questions?</T>
                  </p>
                  <motion.a
                    href="https://github.com/ugurkocde/IntuneGet/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-cyan hover:underline sm:text-base"
                    whileHover={shouldReduceMotion ? {} : { x: 2 }}
                    transition={springPresets.snappy}
                  >
                    <T id="faq.open-issue">Open a GitHub Issue</T>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </motion.a>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </div>
    </section>
  );
}
