"use client";

import { ExternalLink, Quote } from "lucide-react";
import { T } from "gt-next";
import { Linkedin } from "@/components/icons/brand-icons";
import { FadeIn } from "../animations/FadeIn";

interface Testimonial {
  quote: string;
  name: string;
  linkedin: string;
  company?: {
    name: string;
    website: string;
    linkedin: string;
  };
}

// Real customer quotes, published with the author's permission. Keep them
// verbatim (translated only where the original was not in English).
const testimonials: Testimonial[] = [
  {
    quote:
      "IntuneGet let me deploy my entire business application suite through Intune without the time-consuming overhead of manual packaging. As an MSSP, it gives me the flexibility I need for diverse client environments while delivering streamlined, reliable application deployments and updates.",
    name: "Hodge Kaufmann",
    linkedin: "https://www.linkedin.com/in/hodge-k-001110222",
    company: {
      name: "DotStar",
      website: "https://securedotstar.com/",
      linkedin: "https://www.linkedin.com/company/108982302",
    },
  },
  {
    quote:
      "IntuneGet is a free deployment tool for Intune, so there is really nothing to complain about. Support requests get an immediate response and suggestions are implemented quickly.",
    name: "Mücahit Savas",
    linkedin: "https://www.linkedin.com/in/mucsav1977/",
  },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export function TestimonialsSection() {
  return (
    <section
      id="testimonials"
      className="relative w-full scroll-mt-20 overflow-hidden border-t border-overlay/[0.06] bg-bg-deepest py-16 md:scroll-mt-24 md:py-20"
    >
      <div className="container relative mx-auto max-w-6xl px-4 md:px-6">
        <FadeIn>
          <h2 className="text-balance text-center text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            <T id="testimonials.heading">What admins say about IntuneGet</T>
          </h2>
        </FadeIn>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {testimonials.map((testimonial, index) => (
            <FadeIn key={testimonial.name} delay={0.08 + index * 0.06}>
              <figure className="flex h-full flex-col rounded-2xl border border-overlay/10 bg-bg-surface p-6 shadow-card sm:p-7">
                <Quote
                  className="h-7 w-7 text-accent-cyan/60"
                  aria-hidden="true"
                />
                <blockquote className="mt-4 flex-1 text-pretty text-base leading-relaxed text-text-primary md:text-lg">
                  <p>
                    <T>{testimonial.quote}</T>
                  </p>
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3 border-t border-overlay/10 pt-5">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent-cyan/25 bg-accent-cyan/[0.08] text-sm font-semibold text-accent-cyan"
                    aria-hidden="true"
                  >
                    {initials(testimonial.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <a
                      href={testimonial.linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${testimonial.name} on LinkedIn`}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-primary transition-colors hover:text-accent-cyan"
                    >
                      {testimonial.name}
                      <Linkedin className="h-3.5 w-3.5 text-[#0A66C2]" />
                    </a>
                    {testimonial.company && (
                      <span className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                        <a
                          href={testimonial.company.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 transition-colors hover:text-accent-cyan"
                        >
                          {testimonial.company.name}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                        <a
                          href={testimonial.company.linkedin}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${testimonial.company.name} on LinkedIn`}
                          className="transition-colors hover:text-[#0A66C2]"
                        >
                          <Linkedin className="h-3 w-3" />
                        </a>
                      </span>
                    )}
                  </span>
                </figcaption>
              </figure>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
