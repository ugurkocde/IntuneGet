"use client";

import Image from "next/image";
import { T } from "gt-next";
import { FadeIn } from "../animations/FadeIn";
import { DeploymentFeed } from "../ui/DeploymentFeed";

interface ProductSlide {
  id: string;
  caption: string;
  alt: string;
  /**
   * Screenshot path under public/screenshots/ (e.g. "/screenshots/search.png").
   * When absent, the slide renders the live packaging simulation fallback.
   * Adding real screenshots is a data-only change: drop the file into
   * public/screenshots/ and add a slide entry with its src here.
   */
  src?: string;
  /**
   * Optional demo video embed URL. When set, the slide renders an iframe
   * instead of an image or the simulation fallback.
   */
  videoUrl?: string;
}

const slides: ProductSlide[] = [
  {
    id: "packaging-simulation",
    caption: "Search, package, and upload apps to Intune from one screen.",
    alt: "IntuneGet packaging apps and uploading them to Microsoft Intune",
    // No src: renders the live packaging simulation until real screenshots land.
  },
  // Example screenshot slide (data-only addition):
  // { id: "app-search", src: "/screenshots/app-search.png", caption: "...", alt: "..." },
  // Example demo video slide:
  // { id: "demo-video", videoUrl: "https://www.youtube-nocookie.com/embed/VIDEO_ID", caption: "...", alt: "..." },
];

function BrowserFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated shadow-card">
      {/* Browser chrome bar */}
      <div className="flex items-center gap-2 border-b border-overlay/10 bg-bg-surface px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-overlay/15" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-overlay/15" aria-hidden="true" />
        <span className="h-2.5 w-2.5 rounded-full bg-overlay/15" aria-hidden="true" />
        <span className="ml-3 hidden rounded-md bg-overlay/[0.06] px-3 py-1 font-mono text-xs text-text-muted sm:inline-block">
          intuneget.com
        </span>
      </div>
      <div className="p-4 md:p-6">{children}</div>
    </div>
  );
}

export function ProductSection() {
  return (
    <section className="relative w-full py-20 md:py-28 overflow-hidden bg-bg-surface">
      <div className="container relative px-4 md:px-6 mx-auto max-w-6xl">
        {/* Section header */}
        <div className="text-center mb-12 md:mb-16 space-y-4">
          <FadeIn>
            <span className="inline-block font-mono text-xs tracking-wider text-accent-cyan uppercase mb-4">
              <T id="product.badge">Product</T>
            </span>
          </FadeIn>
          <FadeIn delay={0.1}>
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-text-primary">
              <T id="product.heading">See It Work</T>
            </h2>
          </FadeIn>
          <FadeIn delay={0.2}>
            <p className="mx-auto max-w-2xl text-lg text-text-secondary">
              <T id="product.subheading">
                From catalog search to a deployed Intune app in about 5 minutes,
                without touching a packaging script.
              </T>
            </p>
          </FadeIn>
        </div>

        {/* Media frames */}
        <div className="mx-auto max-w-4xl space-y-12">
          {slides.map((slide, index) => (
            <FadeIn key={slide.id} delay={0.2 + index * 0.1}>
              <figure className="space-y-3">
                {slide.videoUrl ? (
                  <BrowserFrame>
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl">
                      <iframe
                        src={slide.videoUrl}
                        title={slide.alt}
                        className="absolute inset-0 h-full w-full"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </BrowserFrame>
                ) : slide.src ? (
                  <BrowserFrame>
                    <Image
                      src={slide.src}
                      alt={slide.alt}
                      width={1600}
                      height={900}
                      className="w-full rounded-xl"
                    />
                  </BrowserFrame>
                ) : (
                  <div className="space-y-3">
                    <div className="inline-flex items-center rounded-full border border-overlay/10 bg-bg-elevated/85 px-3 py-1 text-xs font-medium text-text-secondary">
                      <T id="product.simulation">Live packaging simulation</T>
                    </div>
                    {/* DeploymentFeed renders its own browser-chrome frame */}
                    <DeploymentFeed />
                  </div>
                )}
                <figcaption className="text-center text-sm text-text-muted">
                  <T>{slide.caption}</T>
                </figcaption>
              </figure>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
