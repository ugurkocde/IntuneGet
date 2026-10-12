"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { T, useLocale } from "gt-next";
import { Linkedin } from "@/components/icons/brand-icons";
import { FadeIn } from "../animations/FadeIn";
import { cn } from "@/lib/utils";

interface Testimonial {
  /** Static <T> content, so the translation CLI can extract it at build time. */
  quote: ReactNode;
  /**
   * The author's own words when they were not written in English. Readers of
   * that language see this verbatim instead of a translation of a translation.
   */
  original?: {
    language: string;
    quote: string;
  };
  name: string;
  linkedin: string;
  /** Path under /public. Falls back to initials when missing. */
  avatar?: string;
  role?: ReactNode;
  company?: {
    name: string;
    website: string;
    linkedin: string;
  };
}

// Real customer quotes, published with the author's permission. Keep them
// verbatim; the English text of a non-English quote is our translation.
const testimonials: Testimonial[] = [
  {
    quote: (
      <T>
        IntuneGet let me deploy my entire business application suite through
        Intune without the time-consuming overhead of manual packaging. As an
        MSSP, it gives me the flexibility I need for diverse client
        environments while delivering streamlined, reliable application
        deployments and updates.
      </T>
    ),
    name: "Hodge Kaufmann",
    linkedin: "https://www.linkedin.com/in/hodge-k-001110222",
    avatar: "/testimonials/hodge-kaufmann.jpg",
    role: <T>CEO</T>,
    company: {
      name: "DotStar",
      website: "https://securedotstar.com/",
      linkedin: "https://www.linkedin.com/company/108982302",
    },
  },
  {
    quote: (
      <T>
        IntuneGet is a free deployment tool for Intune, so there is really
        nothing to complain about. Support requests get an immediate response
        and suggestions are implemented quickly.
      </T>
    ),
    original: {
      language: "de",
      quote:
        "IntuneGet.com ist ein kostenloses Bereitstellungswerkzeug für Intune, da kann man sich wirklich nicht beschweren. Auf Supportanfragen wird sofort reagiert und Vorschläge werden zügig umgesetzt.",
    },
    name: "Mücahit Savas",
    linkedin: "https://www.linkedin.com/in/mucsav1977/",
    role: <T>IT Systems Administrator</T>,
  },
];

function Avatar({ testimonial }: { testimonial: Testimonial }) {
  const className = "h-14 w-14 shrink-0 rounded-full";

  if (testimonial.avatar) {
    return (
      <Image
        src={testimonial.avatar}
        alt=""
        width={144}
        height={144}
        className={cn(className, "object-cover")}
      />
    );
  }

  const initials = testimonial.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

  return (
    <span
      aria-hidden="true"
      className={cn(
        className,
        "flex items-center justify-center bg-accent-cyan/[0.08] text-sm font-semibold text-accent-cyan"
      )}
    >
      {initials}
    </span>
  );
}

function Attribution({ testimonial }: { testimonial: Testimonial }) {
  return (
    <figcaption className="mt-8 flex items-start gap-4 text-left">
      <Avatar testimonial={testimonial} />
      <div className="min-w-0">
        <a
          href={testimonial.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="group inline-flex items-center gap-1.5 text-base font-semibold text-text-primary transition-colors hover:text-accent-cyan md:text-lg"
        >
          {testimonial.name}
          <ArrowUpRight
            className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
          <span className="sr-only">on LinkedIn</span>
        </a>
        {(testimonial.role || testimonial.company) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-text-secondary md:text-base">
            {testimonial.role && (
              <span>
                {testimonial.role}
                {testimonial.company && ","}
              </span>
            )}
            {testimonial.company && (
              <>
                <a
                  href={testimonial.company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-overlay/30 underline-offset-4 transition-colors hover:text-accent-cyan hover:decoration-accent-cyan"
                >
                  {testimonial.company.name}
                </a>
                <a
                  href={testimonial.company.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${testimonial.company.name} on LinkedIn`}
                  className="ml-0.5 text-text-muted transition-colors hover:text-[#0A66C2]"
                >
                  <Linkedin className="h-3.5 w-3.5" />
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </figcaption>
  );
}

export function TestimonialsSection() {
  const language = useLocale()?.split("-")[0];

  return (
    <section
      id="testimonials"
      className="relative w-full scroll-mt-20 border-t border-overlay/[0.06] py-20 md:scroll-mt-24 md:py-28"
    >
      <div className="container mx-auto max-w-6xl px-4 md:px-6">
        <FadeIn>
          <p className="text-center font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent-cyan md:text-sm">
            <T>From the field</T>
          </p>
        </FadeIn>

        <div className="mt-12 grid gap-14 md:mt-16 lg:grid-cols-2 lg:gap-0 lg:divide-x lg:divide-overlay/10">
          {testimonials.map((testimonial, index) => (
            <FadeIn
              key={testimonial.name}
              delay={0.08 + index * 0.08}
              className={cn(
                "flex",
                index === 0 ? "lg:pr-14" : "border-t border-overlay/10 pt-14 lg:border-t-0 lg:pl-14 lg:pt-0"
              )}
            >
              <figure className="flex flex-1 flex-col justify-between">
                <blockquote className="text-pretty text-xl font-semibold leading-snug tracking-tight text-text-primary md:text-2xl md:leading-[1.35]">
                  <p>
                    &ldquo;
                    {testimonial.original?.language === language
                      ? testimonial.original.quote
                      : testimonial.quote}
                    &rdquo;
                  </p>
                </blockquote>
                <Attribution testimonial={testimonial} />
              </figure>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
