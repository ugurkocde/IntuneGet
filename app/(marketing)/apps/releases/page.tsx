import { AppIcon } from "@/components/AppIcon";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarDays, Search } from "lucide-react";
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
  ["catalog-release-history-v4"],
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
  const completed = sync?.status === "success" || sync?.status === "partial";
  const status = sync?.status === "running"
    ? "Catalog sync in progress"
    : sync ? "Latest sync failed" : "History from the catalog snapshot";

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-28 lg:px-8 lg:pt-36"
      >
        <header className="mb-10">
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
            <aside className="mt-5 text-sm text-text-muted">
              {!completed && (
                <p className="mb-2 font-medium text-text-secondary">
                  <T><Var>{status}</Var></T>
                </p>
              )}
              <p>
                <T>Last checked:</T>{" "}
                {sync?.lastSuccessfulAt ? (
                  <time dateTime={sync.lastSuccessfulAt}>
                    {syncDateFormat.format(new Date(sync.lastSuccessfulAt))}{" "}
                    (UTC)
                  </time>
                ) : (
                  <T>Not yet recorded</T>
                )}
              </p>
              {!completed && sync?.completedAt &&
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
            className="inline-flex min-h-6 items-center font-medium text-text-secondary underline decoration-overlay/20 underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
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
          <div className="space-y-7">
            {[...groups].map(([day, rows]) => (
              <section
                key={day}
                aria-labelledby={`day-${day}`}
                className="grid gap-3 lg:grid-cols-[130px_1fr]"
              >
                <h2
                  id={`day-${day}`}
                  className="pt-3 text-sm font-semibold text-text-secondary"
                >
                  <time dateTime={day}>{dateLabel(day)}</time>
                </h2>
                <ul className="min-w-0 divide-y divide-overlay/10 rounded-xl border border-overlay/10 bg-bg-elevated">
                  {rows.map((row) => (
                    <li
                      key={`${row.winget_id}:${row.version}`}
                      className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 first:rounded-t-xl last:rounded-b-xl hover:bg-overlay/[0.025] focus-within:bg-overlay/[0.025] sm:grid-cols-[32px_minmax(0,1fr)_auto]"
                    >
                      <div className="col-start-1 row-start-1 row-span-3 pt-0.5" aria-hidden="true">
                        <AppIcon packageId={row.winget_id} packageName={row.name} size="sm" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                          <Link
                            href={`/apps/${encodeURIComponent(row.winget_id)}`}
                            className="break-words text-[15px] font-semibold leading-6 text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                          >
                            {row.name}
                          </Link>
                          {!row.previous_version && (
                            <span className="rounded-md border border-overlay/10 px-1.5 py-0.5 text-[10px] text-text-secondary">
                              <T>First tracked</T>
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs tabular-nums sm:col-start-3 sm:row-start-1 sm:max-w-64 sm:justify-end">
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
                        <span className="break-all rounded-md border border-overlay/10 bg-overlay/[0.03] px-2 py-1 font-semibold text-text-primary">
                          {row.version}
                        </span>
                      </div>
                      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted sm:row-start-2 sm:self-center">
                        <span className="break-all">{row.winget_id}</span>
                        {row.release_date && (
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays
                              aria-hidden="true"
                              className="h-3 w-3 shrink-0"
                            />
                            <span>
                              <T>Released</T>{" "}
                              <time dateTime={row.release_date}>
                                {dateLabel(row.release_date)}
                              </time>
                            </span>
                          </span>
                        )}
                      </div>
                      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted sm:col-[2/-1] sm:row-start-3 sm:justify-between">
                        {row.detailsUnavailable ? (
                          <p>
                            <T>
                              Release notes and scan details are temporarily
                              unavailable.
                            </T>
                          </p>
                        ) : (
                          <>
                            <p className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-medium text-text-secondary">
                                VirusTotal:
                              </span>
                              {row.virusTotal ? (
                                <>
                                  <a
                                    href={`https://www.virustotal.com/gui/file/${row.virusTotal.hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex min-h-6 items-center font-medium text-text-secondary underline decoration-overlay/20 underline-offset-4 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                                  >
                                    {row.virusTotal.status === "found" &&
                                    row.virusTotal.total != null &&
                                    row.virusTotal.total > 0 &&
                                    row.virusTotal.malicious != null &&
                                    row.virusTotal.suspicious != null ? (
                                      <T>
                                        <Var>{row.virusTotal.malicious}</Var>/
                                        <Var>{row.virusTotal.total}</Var>{" "}
                                        malicious,{" "}
                                        <Var>{row.virusTotal.suspicious}</Var>{" "}
                                        suspicious
                                      </T>
                                    ) : row.virusTotal.status ===
                                      "not_found" ? (
                                      <T>No report found</T>
                                    ) : row.virusTotal.status === "pending" ? (
                                      <T>Report pending</T>
                                    ) : row.virusTotal.status === "error" ? (
                                      <T>Lookup unavailable</T>
                                    ) : (
                                      <T>Open report</T>
                                    )}
                                  </a>
                                  {row.virusTotal.architecture && (
                                    <span>({row.virusTotal.architecture})</span>
                                  )}
                                  {row.virusTotal.scannedAt && (
                                    <time dateTime={row.virusTotal.scannedAt}>
                                      <T>Analyzed</T>{" "}
                                      {dateLabel(row.virusTotal.scannedAt)}
                                    </time>
                                  )}
                                </>
                              ) : (
                                <T>Installer hash unavailable</T>
                              )}
                            </p>
                            {row.release_notes_url && (
                              <a
                                href={row.release_notes_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex min-h-6 shrink-0 items-center gap-1 font-medium text-text-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                              >
                                <T>Release notes</T>
                                <ArrowUpRight
                                  aria-hidden="true"
                                  className="h-3 w-3"
                                />
                              </a>
                            )}
                          </>
                        )}
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
              VirusTotal reports are looked up by the WinGet installer hash
              without installing or uploading the app. Report pending means we
              have not retrieved the result yet. Background lookups only cover versions recorded by IntuneGet
              within the last 72 hours and run within the available API quota.
              Older versions retain cached findings and direct report links. You can open
              the VirusTotal link while waiting. Results are cached and reflect
              the recorded scan date. Zero detections do not guarantee safety.
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
