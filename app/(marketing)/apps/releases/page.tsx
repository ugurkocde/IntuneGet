import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { ArrowRight, CalendarDays, Search } from "lucide-react";
import { T, Var } from "gt-next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { getCatalogSource } from "@/lib/catalog";
import {
  historyUrl,
  parseHistoryFilters,
  type ReleaseHistoryFilters,
} from "@/lib/catalog/release-history";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const filters = parseHistoryFilters(await searchParams);
  return {
    title: "Catalog Release History - IntuneGet",
    description:
      "Explore app versions recorded in the IntuneGet catalog, with monthly history, publisher release dates, and sync status.",
    alternates: { canonical: "https://intuneget.com/apps/releases" },
    robots: {
      index:
        !filters.query &&
        !filters.month &&
        filters.kind === "all" &&
        filters.page === 1,
      follow: true,
    },
  };
}
const loadHistory = unstable_cache(
  (filters: ReleaseHistoryFilters) =>
    getCatalogSource().getReleaseHistory(filters),
  ["catalog-release-history-v1"],
  { revalidate: 300 },
);
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const syncDateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
function dateLabel(value: string) {
  return dateFormat.format(new Date(value));
}
const control =
  "min-h-11 w-full rounded-lg border border-overlay/15 bg-bg-deepest px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent-cyan";

export default async function CatalogReleasesPage({ searchParams }: Props) {
  const filters = parseHistoryFilters(await searchParams);
  const result = await loadHistory(filters).catch(() => null);
  const groups = new Map<string, NonNullable<typeof result>["rows"]>();
  for (const row of result?.rows ?? []) {
    const day = new Date(row.detected_at).toISOString().slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), row]);
  }
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / 40));
  const sync = result?.sync;
  const status =
    sync?.status === "success"
      ? "Last run completed successfully"
      : sync?.status === "running"
        ? "Catalog sync in progress"
        : sync?.status === "partial"
          ? "Completed with unavailable packages"
          : sync
            ? "Latest sync failed"
            : "History from the catalog snapshot";

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-28 lg:px-8 lg:pt-36"
      >
        <header className="mb-10 grid gap-8 lg:grid-cols-[1fr_300px] lg:items-end">
          <div>
            <Link
              href="/apps"
              className="text-sm text-accent-cyan hover:underline"
            >
              <T>App catalog</T>
            </Link>
            <p className="mb-3 mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">
              <T>The catalog, over time</T>
            </p>
            <h1 className="text-balance text-4xl font-bold tracking-tight text-text-primary sm:text-5xl">
              <T>Catalog release history</T>
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary">
              <T>
                Follow the app versions arriving in IntuneGet. Find an app,
                explore a month, and see what changed.
              </T>
            </p>
          </div>
          {result && (
            <aside className="rounded-xl border border-overlay/10 bg-bg-elevated p-5 text-sm">
              <p className="flex items-center gap-2 font-medium text-text-primary">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${sync?.status === "success" ? "bg-emerald-500" : "bg-amber-500"}`}
                />
                <T>
                  <Var>{status}</Var>
                </T>
              </p>
              <p className="mt-3 leading-relaxed text-text-secondary">
                <T>Last completed catalog check:</T>{" "}
                {sync?.lastSuccessfulAt ? (
                  <time dateTime={sync.lastSuccessfulAt}>
                    {syncDateFormat.format(new Date(sync.lastSuccessfulAt))}{" "}
                    (UTC)
                  </time>
                ) : (
                  <T>Not yet recorded</T>
                )}
              </p>
              {sync?.status === "partial" && (
                <p className="mt-3 text-xs leading-relaxed text-text-secondary">
                  <T>
                    The check completed, but some manifests were unavailable
                    from WinGet. Existing records are retained and retried on
                    the next sync.
                  </T>
                </p>
              )}
              {sync?.completedAt &&
                sync.completedAt !== sync.lastSuccessfulAt && (
                  <p className="mt-2 text-xs text-text-muted">
                    <T>Last attempt:</T>{" "}
                    <time dateTime={sync.completedAt}>
                      {syncDateFormat.format(new Date(sync.completedAt))} (UTC)
                    </time>
                  </p>
                )}
            </aside>
          )}
        </header>

        {result && (
          <dl className="mb-8 grid grid-cols-3 divide-x divide-overlay/10 rounded-xl border border-overlay/10 bg-bg-elevated">
            {[
              ["Versions recorded", result.total],
              ["Apps represented", result.apps],
              ["First tracked apps", result.firstTracked],
            ].map(([label, value]) => (
              <div key={label} className="px-3 py-5 sm:px-6">
                <dt className="text-sm text-text-secondary">
                  <T>
                    <Var>{label}</Var>
                  </T>
                </dt>
                <dd className="mt-2 text-2xl font-semibold tabular-nums sm:text-3xl text-text-primary">
                  {Number(value).toLocaleString("en-US")}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <form
          action="/apps/releases"
          className="mb-5 grid gap-4 rounded-xl border border-overlay/10 bg-bg-elevated p-5 sm:grid-cols-2 lg:grid-cols-[1fr_180px_190px_auto] lg:items-end"
        >
          <div>
            <label
              htmlFor="history-search"
              className="mb-2 block text-sm font-medium text-text-primary"
            >
              <T>Search apps</T>
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-text-muted"
              />
              <input
                id="history-search"
                name="q"
                type="search"
                autoComplete="off"
                maxLength={120}
                defaultValue={filters.query}
                placeholder="Name, publisher, or WinGet ID…"
                className={`${control} pl-10`}
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="history-month"
              className="mb-2 block text-sm font-medium text-text-primary"
            >
              <T>Month (UTC)</T>
            </label>
            <select
              id="history-month"
              name="month"
              defaultValue={filters.month}
              className={control}
            >
              <option value="">All months</option>
              {[
                ...new Set([
                  ...(result?.months ?? []),
                  ...(filters.month ? [filters.month] : []),
                ]),
              ]
                .sort()
                .reverse()
                .map((month) => (
                  <option key={month} value={month}>
                    {new Intl.DateTimeFormat("en-GB", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(`${month}-01T00:00:00Z`))}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="history-kind"
              className="mb-2 block text-sm font-medium text-text-primary"
            >
              <T>Record type</T>
            </label>
            <select
              id="history-kind"
              name="kind"
              defaultValue={filters.kind}
              className={control}
            >
              <option value="all">All records</option>
              <option value="updated">Version changes</option>
              <option value="first">First tracked</option>
            </select>
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-accent-cyan px-6 py-2 text-sm font-semibold text-bg-deepest hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-cyan"
          >
            <T>Apply filters</T>
          </button>
        </form>
        <div className="mb-10 flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
          <p>
            <T>
              Counts reflect your filters. Dates show when IntuneGet first
              recorded a version.
            </T>
          </p>
          <Link
            href="/apps/releases"
            className="text-accent-cyan hover:underline"
          >
            <T>Clear filters</T>
          </Link>
        </div>

        {!result ? (
          <div role="alert" className="rounded-xl border border-overlay/15 p-8">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>History is temporarily unavailable</T>
            </h2>
            <p className="mt-2 text-text-secondary">
              <T>We could not load the catalog history. Please try again.</T>
            </p>
            <Link
              href={historyUrl(filters, filters.page)}
              className="mt-5 inline-flex min-h-11 items-center text-accent-cyan hover:underline"
            >
              <T>Try again</T>
            </Link>
          </div>
        ) : result.rows.length === 0 ? (
          <div className="rounded-xl border border-overlay/10 p-10 text-center">
            <CalendarDays
              aria-hidden="true"
              className="mx-auto mb-4 h-8 w-8 text-text-muted"
            />
            <h2 className="text-xl font-semibold text-text-primary">
              <T>No records to show</T>
            </h2>
            <p className="mt-2 text-text-secondary">
              <T>Try another app or month, or clear your filters.</T>
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {[...groups].map(([day, rows]) => (
              <section
                key={day}
                aria-labelledby={`day-${day}`}
                className="grid gap-4 lg:grid-cols-[150px_1fr]"
              >
                <h2
                  id={`day-${day}`}
                  className="pt-4 text-sm font-semibold text-text-secondary"
                >
                  <time dateTime={day}>{dateLabel(day)}</time>
                </h2>
                <ul className="divide-y divide-overlay/10 overflow-hidden rounded-xl border border-overlay/10 bg-bg-elevated">
                  {rows.map((row) => (
                    <li
                      key={`${row.winget_id}:${row.version}`}
                      className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-3">
                          <Link
                            href={`/apps/${encodeURIComponent(row.winget_id)}`}
                            className="break-words font-semibold text-text-primary hover:text-accent-cyan"
                          >
                            {row.name}
                            <span className="sr-only"> {row.winget_id}</span>
                          </Link>
                          {!row.previous_version && (
                            <span className="rounded-md bg-overlay/5 px-2 py-1 text-xs text-text-secondary">
                              <T>First tracked</T>
                            </span>
                          )}
                        </div>
                        <p className="mt-2 break-all text-xs text-text-muted">
                          {row.winget_id}
                        </p>
                        {row.release_date && (
                          <p className="mt-2 text-xs text-text-secondary">
                            <T>Publisher release:</T>{" "}
                            <time dateTime={row.release_date}>
                              {dateLabel(row.release_date)}
                            </time>
                          </p>
                        )}
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-sm tabular-nums sm:max-w-80 sm:justify-end">
                        {row.previous_version && (
                          <>
                            <span className="break-all text-text-muted">
                              {row.previous_version}
                            </span>
                            <ArrowRight
                              aria-label="to"
                              className="h-3 w-3 shrink-0 text-text-muted"
                            />
                          </>
                        )}
                        <span className="break-all font-semibold text-text-primary">
                          {row.version}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {result && (pages > 1 || filters.page > 1) && (
          <nav
            aria-label="Release history pagination"
            className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm"
          >
            {filters.page > 1 && (
              <Link
                href={historyUrl(filters, filters.page - 1)}
                className="inline-flex min-h-11 items-center text-accent-cyan hover:underline"
              >
                <T>Previous</T>
              </Link>
            )}
            <p className="text-text-secondary">
              <T>
                Page <Var>{filters.page}</Var> of <Var>{pages}</Var>
              </T>
            </p>
            {filters.page < pages && (
              <Link
                href={historyUrl(filters, filters.page + 1)}
                className="inline-flex min-h-11 items-center text-accent-cyan hover:underline"
              >
                <T>Next</T>
              </Link>
            )}
          </nav>
        )}
        <aside className="mt-14 border-t border-overlay/10 pt-6 text-sm leading-relaxed text-text-muted">
          <h2 className="font-semibold text-text-secondary">
            <T>About this history</T>
          </h2>
          <p className="mt-2">
            <T>
              This is an observation history, not a complete archive of
              publisher releases. First tracked means the earliest version we
              have recorded for an app, including apps imported when tracking
              began. It does not necessarily mean a newly released product.
              Versions missed between syncs may be absent. A version change may
              also reflect an upstream rollback.
            </T>
          </p>
          {result?.coverageStart && (
            <p className="mt-2">
              <T>Available records begin:</T>{" "}
              <time dateTime={result.coverageStart}>
                {dateLabel(result.coverageStart)}
              </time>
              .{" "}
              <T>Publisher dates appear only when provided by the manifest.</T>
            </p>
          )}
        </aside>
      </main>
      <Footer />
    </div>
  );
}
