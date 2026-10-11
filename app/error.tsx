"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reportPageError } from "@/lib/logging/report-page-error";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => { reportPageError('root', error.digest); }, [error]);
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 pt-24 lg:pt-28">
        <div className="text-center max-w-lg">
          <p className="font-mono text-sm text-red-400 mb-4">Error</p>
          <h1 className="text-3xl font-bold text-text-primary sm:text-4xl mb-4">
            Something Went Wrong
          </h1>
          <p className="text-text-secondary mb-8 leading-relaxed">
            An unexpected error occurred. You can try again or navigate back to a
            working page.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => reset()}
              className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-white bg-accent-cyan rounded-xl hover:bg-accent-cyan-dim transition-all"
            >
              Try Again
            </button>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-all"
            >
              Back to Home
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center gap-2 px-8 py-3 text-base font-semibold text-text-secondary bg-bg-elevated border border-overlay/10 rounded-xl hover:bg-overlay/[0.04] transition-all"
            >
              Documentation
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
