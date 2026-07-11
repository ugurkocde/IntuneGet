"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { T, Var, useGT } from "gt-next";
import { AppIcon } from "@/components/AppIcon";

interface SearchResult {
  id: string;
  name: string;
  publisher: string;
  category: string | null;
  iconPath: string | null;
}

/**
 * Simple public catalog search backed by the unauthenticated
 * /api/winget/search route. Display-only: results carry no deploy actions.
 */
export function CatalogSearch() {
  const t = useGT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/winget/search?q=${encodeURIComponent(trimmed)}&limit=12`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const json = await res.json();
        setResults(Array.isArray(json.packages) ? json.packages : []);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="space-y-6">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search the catalog, e.g. Chrome, 7-Zip, VS Code")}
          aria-label={t("Search the app catalog")}
          className="w-full rounded-xl border border-overlay/10 bg-bg-elevated py-3 pl-12 pr-4 text-base text-text-primary placeholder:text-text-muted focus:border-accent-cyan/40 focus:outline-none focus:ring-2 focus:ring-accent-cyan/20 transition-colors"
        />
        {isLoading && (
          <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-text-muted" />
        )}
      </div>

      {results !== null && (
        <div>
          {results.length === 0 && !isLoading ? (
            <p className="text-sm text-text-muted">
              <T>
                No results for &quot;<Var>{query.trim()}</Var>&quot;. Try a
                different name or browse the popular apps below.
              </T>
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center gap-4 rounded-2xl border border-overlay/10 bg-bg-elevated p-4"
                >
                  <AppIcon
                    packageId={app.id}
                    packageName={app.name}
                    iconPath={app.iconPath ?? undefined}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-text-primary">
                      {app.name}
                    </p>
                    <p className="truncate text-sm text-text-muted">
                      {app.publisher}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
