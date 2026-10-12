"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { LandingStatValues } from "@/hooks/useLandingStats";

/**
 * Viewport-deferred below-fold sections. These are animation-heavy marketing
 * sections with low SEO value; skipping their SSR + initial hydration keeps
 * the landing page's first load JS and main-thread work down (they were part
 * of a ~2s hydration burst on throttled mobile). Each mounts when the visitor
 * scrolls within 600px of it. SEO-relevant sections (How It Works, Trust,
 * FAQ, Footer) intentionally stay server-rendered and eager.
 */

const CapabilitiesSection = dynamic(
  () => import("./sections/FeaturesSection").then((m) => m.CapabilitiesSection),
  { ssr: false }
);
const ComparisonSection = dynamic(
  () => import("./sections/ComparisonSection").then((m) => m.ComparisonSection),
  { ssr: false }
);
const MSPSection = dynamic(
  () => import("./sections/MSPSection").then((m) => m.MSPSection),
  { ssr: false }
);
const CTASection = dynamic(
  () => import("./sections/CTASection").then((m) => m.CTASection),
  { ssr: false }
);

interface LazyMountProps {
  children: ReactNode;
  /** Approximate section height so the scrollbar doesn't jump on mount. */
  minHeight: number;
  /** Anchor id kept on the placeholder so #links scroll here before mount. */
  anchorId?: string;
}

function LazyMount({ children, minHeight, anchorId }: LazyMountProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setMounted(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      // The mounted section renders its own anchor id; drop it here to avoid
      // duplicate ids in the document.
      id={mounted ? undefined : anchorId}
      style={mounted ? undefined : { minHeight }}
    >
      {mounted ? children : null}
    </div>
  );
}

export function DeferredCapabilities() {
  return (
    <LazyMount minHeight={900}>
      <CapabilitiesSection />
    </LazyMount>
  );
}

export function DeferredComparison() {
  return (
    <LazyMount minHeight={800}>
      <ComparisonSection />
    </LazyMount>
  );
}

export function DeferredMSP() {
  return (
    <LazyMount minHeight={700}>
      <MSPSection />
    </LazyMount>
  );
}

export function DeferredCTA({ initialStats }: { initialStats?: LandingStatValues }) {
  return (
    <LazyMount minHeight={700} anchorId="get-started">
      <CTASection initialStats={initialStats} />
    </LazyMount>
  );
}
