"use client";

import Image from "next/image";
import { MessageSquareQuote } from "lucide-react";
import { T } from "gt-next";
import { Linkedin } from "@/components/icons/brand-icons";
import { FadeIn } from "../animations/FadeIn";
import { cn } from "@/lib/utils";

interface Testimonial {
  quote: string;
  name: string;
  linkedin: string;
  /** Path under /public. Falls back to initials when missing. */
  avatar?: string;
  company?: {
    name: string;
    website: string;
    linkedin: string;
  };
}

// Real customer quotes, published with the author's permission. Keep them
// verbatim (translated only where the original was not in English).
const featured: Testimonial = {
  quote:
    "IntuneGet let me deploy my entire business application suite through Intune without the time-consuming overhead of manual packaging. As an MSSP, it gives me the flexibility I need for diverse client environments while delivering streamlined, reliable application deployments and updates.",
  name: "Hodge Kaufmann",
  linkedin: "https://www.linkedin.com/in/hodge-k-001110222",
  avatar: "/testimonials/hodge-kaufmann.jpg",
  company: {
    name: "DotStar",
    website: "https://securedotstar.com/",
    linkedin: "https://www.linkedin.com/company/108982302",
  },
};

const secondary: Testimonial = {
  quote:
    "IntuneGet is a free deployment tool for Intune, so there is really nothing to complain about. Support requests get an immediate response and suggestions are implemented quickly.",
  name: "Mücahit Savas",
  linkedin: "https://www.linkedin.com/in/mucsav1977/",
};

function Avatar({ testimonial, size }: { testimonial: Testimonial; size: "lg" | "sm" }) {
  const dimension = size === "lg" ? 56 : 44;
  const className = cn(
    "shrink-0 rounded-full",
    size === "lg" ? "h-14 w-14" : "h-11 w-11"
  );

  if (testimonial.avatar) {
    return (
      <Image
        src={testimonial.avatar}
        alt=""
        width={dimension}
        height={dimension}
        className={cn(className, "object-cover ring-2 ring-accent-cyan/20")}
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
        "flex items-center justify-center border border-accent-cyan/25 bg-accent-cyan/[0.08] font-semibold text-accent-cyan",
        size === "lg" ? "text-base" : "text-sm"
      )}
    >
      {initials}
    </span>
  );
}

function Attribution({ testimonial, size }: { testimonial: Testimonial; size: "lg" | "sm" }) {
  return (
    <figcaption className="flex items-center gap-4">
      <Avatar testimonial={testimonial} size={size} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">{testimonial.name}</span>
          <a
            href={testimonial.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${testimonial.name} on LinkedIn`}
            className="text-text-muted transition-colors hover:text-[#0A66C2]"
          >
            <Linkedin className="h-4 w-4" />
          </a>
        </div>
        {testimonial.company && (
          <div className="mt-0.5 flex items-center gap-2 text-sm text-text-secondary">
            <a
              href={testimonial.company.website}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-accent-cyan"
            >
              {testimonial.company.name}
            </a>
            <a
              href={testimonial.company.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${testimonial.company.name} on LinkedIn`}
              className="text-text-muted transition-colors hover:text-[#0A66C2]"
            >
              <Linkedin className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    </figcaption>
  );
}

export function TestimonialsSection() {
  return (
    <section
      id="testimonials"
      className="relative w-full scroll-mt-20 overflow-hidden border-t border-overlay/[0.06] py-16 md:scroll-mt-24 md:py-24"
    >
      <div className="container relative mx-auto max-w-6xl px-4 md:px-6">
        <FadeIn>
          <div className="text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent-cyan/25 bg-bg-surface px-4 py-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-primary shadow-sm">
              <MessageSquareQuote
                className="h-4 w-4 text-accent-cyan"
                aria-hidden="true"
              />
              <T>From the community</T>
            </span>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="mt-8 grid overflow-hidden rounded-3xl border border-overlay/10 bg-bg-surface shadow-card lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] lg:divide-x lg:divide-overlay/10">
            <figure className="flex flex-col justify-between gap-8 p-7 sm:p-10">
              <blockquote className="text-pretty text-xl font-medium leading-relaxed tracking-tight text-text-primary md:text-2xl md:leading-snug">
                <p>
                  <span aria-hidden="true" className="text-accent-cyan">
                    &ldquo;
                  </span>
                  <T>{featured.quote}</T>
                  <span aria-hidden="true" className="text-accent-cyan">
                    &rdquo;
                  </span>
                </p>
              </blockquote>
              <Attribution testimonial={featured} size="lg" />
            </figure>

            <figure className="flex flex-col justify-between gap-8 border-t border-overlay/10 bg-overlay/[0.015] p-7 sm:p-10 lg:border-t-0">
              <blockquote className="text-pretty text-base leading-relaxed text-text-secondary md:text-lg">
                <p>
                  <span aria-hidden="true" className="text-accent-cyan">
                    &ldquo;
                  </span>
                  <T>{secondary.quote}</T>
                  <span aria-hidden="true" className="text-accent-cyan">
                    &rdquo;
                  </span>
                </p>
              </blockquote>
              <Attribution testimonial={secondary} size="sm" />
            </figure>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}
