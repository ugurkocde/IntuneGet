"use client";

import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
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
  role?: string;
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
  role: "Managed security services provider",
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

function Avatar({
  testimonial,
  size,
}: {
  testimonial: Testimonial;
  size: "lg" | "sm";
}) {
  const className = cn(
    "shrink-0 rounded-full",
    size === "lg" ? "h-16 w-16 md:h-[72px] md:w-[72px]" : "h-11 w-11"
  );

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

function Attribution({
  testimonial,
  size,
}: {
  testimonial: Testimonial;
  size: "lg" | "sm";
}) {
  return (
    <figcaption
      className={cn(
        "flex items-center justify-center text-left",
        size === "lg" ? "mt-10 gap-5" : "mt-6 gap-4"
      )}
    >
      <Avatar testimonial={testimonial} size={size} />
      <div className="min-w-0">
        <a
          href={testimonial.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "group inline-flex items-center gap-1.5 font-semibold text-text-primary transition-colors hover:text-accent-cyan",
            size === "lg" ? "text-base md:text-lg" : "text-sm md:text-base"
          )}
        >
          {testimonial.name}
          <ArrowUpRight
            className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
          <span className="sr-only">on LinkedIn</span>
        </a>
        {testimonial.company && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-text-secondary md:text-base">
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
              className="text-text-muted transition-colors hover:text-[#0A66C2]"
            >
              <Linkedin className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
        {testimonial.role && (
          <p className="mt-1 text-sm text-text-muted md:text-base">
            <T>{testimonial.role}</T>
          </p>
        )}
      </div>
    </figcaption>
  );
}

export function TestimonialsSection() {
  return (
    <section
      id="testimonials"
      className="relative w-full scroll-mt-20 border-t border-overlay/[0.06] py-20 md:scroll-mt-24 md:py-28"
    >
      <div className="container mx-auto max-w-5xl px-4 text-center md:px-6">
        <FadeIn>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-accent-cyan md:text-sm">
            <T>From the field</T>
          </p>
        </FadeIn>

        <FadeIn delay={0.08}>
          <figure className="mt-10 md:mt-12">
            <blockquote className="text-balance text-2xl font-semibold leading-snug tracking-tight text-text-primary md:text-[2.125rem] md:leading-[1.3]">
              <p>
                &ldquo;<T>{featured.quote}</T>&rdquo;
              </p>
            </blockquote>
            <Attribution testimonial={featured} size="lg" />
          </figure>
        </FadeIn>

        <FadeIn delay={0.16}>
          <figure className="mx-auto mt-16 max-w-3xl border-t border-overlay/10 pt-14 md:mt-20 md:pt-16">
            <blockquote className="text-balance text-lg leading-relaxed text-text-secondary md:text-xl">
              <p>
                &ldquo;<T>{secondary.quote}</T>&rdquo;
              </p>
            </blockquote>
            <Attribution testimonial={secondary} size="sm" />
          </figure>
        </FadeIn>
      </div>
    </section>
  );
}
