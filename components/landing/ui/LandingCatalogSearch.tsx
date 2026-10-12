"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  ChevronRight,
  Loader2,
  PackageCheck,
  Search,
  Upload,
  X,
} from "lucide-react";
import { T, useGT } from "gt-next";
import { AppIcon } from "@/components/AppIcon";
import { useAuthHint } from "@/hooks/useAuthHint";
import { cn } from "@/lib/utils";

interface CatalogResult {
  id: string;
  name: string;
  publisher: string;
  version: string;
  iconPath: string | null;
}

const popularSearches = [
  { label: "Chrome", query: "Chrome" },
  { label: "7-Zip", query: "7-Zip" },
  { label: "VS Code", query: "Visual Studio Code" },
];

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 21 21"
      fill="none"
    >
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export function LandingCatalogSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogResult[] | null>(null);
  const [selected, setSelected] = useState<CatalogResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const t = useGT();
  const isAuthenticated = useAuthHint();
  const uploadSteps = [
    { number: "1", label: <T>Review settings</T> },
    { number: "2", label: <T>Package automatically</T> },
    { number: "3", label: <T>Upload to Intune</T> },
  ];

  useEffect(() => {
    abortRef.current?.abort();
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults(null);
      setSelected(null);
      setIsLoading(false);
      setError(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(false);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/winget/search?q=${encodeURIComponent(trimmed)}&limit=4`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("Catalog search failed");
        }

        const body = await response.json();
        const nextResults = Array.isArray(body.packages)
          ? (body.packages as CatalogResult[]).slice(0, 4)
          : [];

        setResults(nextResults);
        setSelected((current) => {
          if (current) {
            const preserved = nextResults.find((app) => app.id === current.id);
            if (preserved) return preserved;
          }
          return null;
        });
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setSelected(null);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const dashboardHref = selected
    ? `/dashboard/apps?deploy=${encodeURIComponent(selected.id)}`
    : "/dashboard/apps";
  const uploadHref = isAuthenticated
    ? dashboardHref
    : `/auth/signin?callbackUrl=${encodeURIComponent(dashboardHref)}`;

  const statusMessage = useMemo(() => {
    if (isLoading) return t("Searching the Winget catalog");
    if (error) return t("Catalog search is temporarily unavailable");
    if (results) return t("{count} catalog results found", { count: results.length });
    return t("Search the public Winget catalog");
  }, [error, isLoading, results, t]);

  const selectedId = selected?.id ?? null;
  const restoreFocusIdRef = useRef<string | null>(null);

  // The covered list is inert, so keyboard focus follows the card in and back out.
  useEffect(() => {
    if (selectedId) {
      backRef.current?.focus({ preventScroll: true });
      return;
    }
    const restoreId = restoreFocusIdRef.current;
    restoreFocusIdRef.current = null;
    if (restoreId) {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-app-id="${CSS.escape(restoreId)}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [selectedId]);

  const closeDetails = () => {
    restoreFocusIdRef.current = selectedId;
    setSelected(null);
  };

  const runPopularSearch = (value: string) => {
    setQuery(value);
    setSelected(null);
    inputRef.current?.focus();
  };

  return (
    <div className="@container mx-auto w-full max-w-5xl">
      <div className="relative">
        <label htmlFor="landing-catalog-search" className="sr-only">
          <T>Search the Winget app catalog</T>
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 z-10 h-5 w-5 -translate-y-1/2 text-text-muted sm:left-5 sm:h-6 sm:w-6"
        />
        <input
          ref={inputRef}
          id="landing-catalog-search"
          name="catalog-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
          }}
          placeholder="Search Chrome, 7-Zip, VS Code…"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "h-14 w-full rounded-2xl border bg-bg-elevated pl-12 pr-14 text-base text-text-primary shadow-soft-md outline-none transition-[border-color,box-shadow] duration-200 sm:h-16 sm:pl-14 sm:text-lg [&::-webkit-search-cancel-button]:hidden",
            "placeholder:text-text-muted focus:border-accent-cyan/60 focus:ring-4 focus:ring-accent-cyan/10",
            query.length >= 2 ? "border-accent-cyan/35" : "border-overlay/10"
          )}
        />
        {isLoading ? (
          <Loader2
            aria-hidden="true"
            className="absolute right-5 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-accent-cyan"
          />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSelected(null);
              inputRef.current?.focus();
            }}
            aria-label="Clear catalog search"
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-overlay/[0.05] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <AnimatePresence mode="wait" initial={false}>
        {isLoading && query.trim().length >= 2 ? (
          <motion.div
            key="loading"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            className="mt-3 overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated p-2 shadow-soft-lg"
            aria-hidden="true"
          >
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex min-h-[68px] items-center gap-3 rounded-xl px-3 py-2">
                <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-overlay/[0.07] motion-reduce:animate-none" />
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block h-3.5 w-2/5 animate-pulse rounded bg-overlay/[0.08] motion-reduce:animate-none" />
                  <span className="block h-3 w-3/5 animate-pulse rounded bg-overlay/[0.05] motion-reduce:animate-none" />
                </span>
              </div>
            ))}
          </motion.div>
        ) : results !== null ? (
          <motion.div
            key="results"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
            className="mt-4"
          >
            {results.length > 0 ? (
              <div className="grid overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated shadow-soft-lg">
                <motion.div
                  ref={listRef}
                  inert={selected !== null}
                  initial={shouldReduceMotion ? false : "hidden"}
                  animate="visible"
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: shouldReduceMotion ? { duration: 0 } : { staggerChildren: 0.035 },
                    },
                  }}
                  className="col-start-1 row-start-1 min-w-0 p-2"
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <p className="text-left text-xs font-semibold uppercase tracking-wider text-text-muted">
                      <T>Suggested apps</T>
                    </p>
                    <span className="text-xs text-text-muted">
                      <T>Select an app to continue</T>
                    </span>
                  </div>
                  <div>
                    {results.map((app) => (
                      <motion.button
                        key={app.id}
                        type="button"
                        data-app-id={app.id}
                        onClick={() => setSelected(app)}
                        variants={{
                          hidden: { opacity: 0, y: 6 },
                          visible: { opacity: 1, y: 0 },
                        }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
                        className="group flex min-h-[68px] w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-accent-cyan/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                      >
                        <AppIcon
                          packageId={app.id}
                          packageName={app.name}
                          iconPath={app.iconPath ?? undefined}
                          size="md"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-text-primary">{app.name}</span>
                          <span className="block truncate text-sm text-text-muted">
                            {app.publisher} · {app.id}
                          </span>
                        </span>
                        {app.version && (
                          <span className="hidden shrink-0 text-xs text-text-muted sm:block">{app.version}</span>
                        )}
                        <ChevronRight
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent-cyan"
                        />
                      </motion.button>
                    ))}
                  </div>
                  <Link
                    href="/apps"
                    className="mt-1 flex min-h-11 items-center justify-center gap-2 rounded-xl border-t border-overlay/[0.07] px-3 pt-2 text-sm font-medium text-accent-cyan transition-colors hover:text-accent-cyan-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  >
                    <T>Browse the full catalog</T>
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </motion.div>

                {/* Shares the list grid cell, so the card covers the results without a height change. */}
                <AnimatePresence initial={false}>
                  {selected && (
                    <motion.div
                      key={selected.id}
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 40 }}
                      transition={{ duration: shouldReduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") closeDetails();
                      }}
                      className="relative z-10 col-start-1 row-start-1 flex min-w-0 flex-col bg-bg-elevated p-4 text-left sm:p-5"
                    >
                      <div className="flex items-start gap-4 border-b border-overlay/10 pb-4">
                        <AppIcon
                          packageId={selected.id}
                          packageName={selected.name}
                          iconPath={selected.iconPath ?? undefined}
                          size="xl"
                        />
                        <div className="min-w-0 flex-1">
                          <h2 className="truncate pr-9 text-xl font-bold text-text-primary sm:text-2xl">
                            {selected.name}
                          </h2>
                          <p className="truncate pr-9 text-sm text-text-secondary">
                            {selected.publisher}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <code translate="no" className="rounded-md bg-bg-surface px-2 py-1 text-[11px] text-text-secondary">
                              {selected.id}
                            </code>
                            {selected.version && (
                              <span className="text-xs text-text-muted">
                                <T>Version</T> {selected.version}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          ref={backRef}
                          type="button"
                          onClick={closeDetails}
                          aria-label={t("Back to results")}
                          className="absolute right-2 top-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-overlay/[0.05] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                        >
                          <X aria-hidden="true" className="h-5 w-5" />
                        </button>
                      </div>

                      <ol className="my-4 grid gap-3 text-sm text-text-secondary @xl:grid-cols-3">
                        {uploadSteps.map((step) => (
                          <li key={step.number} className="flex items-center gap-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-cyan/10 font-mono text-xs font-bold text-accent-cyan">
                              {step.number}
                            </span>
                            {step.label}
                          </li>
                        ))}
                      </ol>

                      <div className="mt-auto">
                        <Link
                          href={uploadHref}
                          className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent-cyan px-5 py-3 font-semibold text-white shadow-glow-cyan transition-[background-color,box-shadow] duration-200 hover:bg-accent-cyan-dim hover:shadow-glow-cyan-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
                        >
                          <Upload aria-hidden="true" className="h-5 w-5" />
                          <T>Start upload to Intune</T>
                          <ChevronRight aria-hidden="true" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        {!isAuthenticated && (
                          <p className="mt-3 flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-text-muted">
                            <MicrosoftLogo className="mt-0.5 h-4 w-4 shrink-0" />
                            <span><T>Microsoft work account required. We’ll keep your selection.</T></span>
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <div className="rounded-2xl border border-overlay/10 bg-bg-elevated px-5 py-8 text-center shadow-soft">
                <PackageCheck aria-hidden="true" className="mx-auto h-8 w-8 text-text-muted" />
                <h2 className="mt-3 font-semibold text-text-primary">
                  {error ? <T>Catalog search is temporarily unavailable</T> : <T>No matching apps found</T>}
                </h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
                  {error ? (
                    <T>Try again in a moment or browse the public catalog.</T>
                  ) : (
                    <T>Try a different app name, publisher, or Winget package ID.</T>
                  )}
                </p>
                <Link
                  href="/apps"
                  className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-accent-cyan hover:text-accent-cyan-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                >
                  <T>Browse the full catalog</T>
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="prompt"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.15 }}
            className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 lg:justify-start"
          >
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <PackageCheck aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-accent-cyan" />
              <T>Search without signing in</T>
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-text-muted"><T>Try</T></span>
              {popularSearches.map(({ label, query }) => (
                <button
                  key={query}
                  type="button"
                  onClick={() => runPopularSearch(query)}
                  translate="no"
                  className="min-h-10 cursor-pointer rounded-full border border-overlay/10 bg-bg-elevated px-3.5 text-[13px] font-medium text-text-secondary shadow-soft transition-colors hover:border-accent-cyan/30 hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                >
                  {label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
