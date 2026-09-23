import { AppIcon } from "@/components/AppIcon";
import { ReleaseFeedDialog } from "@/components/landing/ReleaseFeedDialog";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getGT } from "gt-next/server";
import { CompleteHistoryError, requireCompleteHistory } from "@/lib/catalog/release-history-cache";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  X,
} from "lucide-react";
import { T, Var } from "gt-next";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { getCatalogSource } from "@/lib/catalog";
import {
  historyUrl,
  appHistoryUrl,
  hasActiveFilters,
  pageWindow,
  parseHistoryFilters,
  updateSize,
  type CatalogRelease,
  type ReleaseHistoryFilters,
} from "@/lib/catalog/release-history";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const PAGE_SIZE = 40;
const loadHistory = unstable_cache(
  async (filters: ReleaseHistoryFilters) =>
    requireCompleteHistory(await getCatalogSource().getReleaseHistory(filters)),
  ["catalog-release-history-v8"],
  { revalidate: 300 },
);
// cache() shares one in-flight load between generateMetadata and the page. Filters are
// serialized because cache() compares arguments by identity.
const loadHistoryOrPartial = cache((key: string) =>
  loadHistory(JSON.parse(key) as ReleaseHistoryFilters).catch(error => error instanceof CompleteHistoryError ? error.result : null));
const loadRecentUpdates = unstable_cache(
  (from: string) => getCatalogSource().countReleaseHistory({ query: "", month: "", kind: "updated", page: 1, from }),
  ["catalog-release-history-recent-v1"],
  { revalidate: 300 },
);

export async function generateMetadata({
  searchParams,
}: Props): Promise<Metadata> {
  const filters = parseHistoryFilters(await searchParams);
  const appName = filters.app ? (await loadHistoryOrPartial(JSON.stringify(filters)))?.rows[0]?.name ?? filters.app : null;
  return {
    title: appName ? `${appName} Version History - IntuneGet` : "WinGet App Release History and Update Tracker - IntuneGet",
    description: appName
      ? `Every ${appName} version IntuneGet has recorded from WinGet, with release notes, installer hashes, and VirusTotal results where available.`
      : "Track every WinGet app update IntuneGet records for Intune, with release notes, installer hashes, VirusTotal results, and monthly history.",
    alternates: { canonical: "https://intuneget.com/apps/releases", types: { "application/rss+xml": `/apps/releases/feed${filters.app ? `?app=${encodeURIComponent(filters.app)}` : ""}` } },
    robots: {
      index: !filters.app && !hasActiveFilters(filters) && filters.page === 1,
      follow: true,
    },
  };
}
const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long",
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
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan";
const metaLink = `inline-flex min-h-6 items-center gap-1 font-medium text-text-secondary hover:text-text-primary hover:underline ${focusRing}`;

function VirusTotalStatus({ release, gt }: { release: CatalogRelease; gt: (text: string) => string }) {
  const vt = release.virusTotal;
  if (release.detailsUnavailable) {
    return <span><T>Scan details temporarily unavailable</T></span>;
  }
  if (!vt) {
    return <span><T>VirusTotal: installer hash unavailable</T></span>;
  }
  const malicious = vt.status === "found" ? vt.malicious : null;
  const suspicious = vt.status === "found" ? vt.suspicious : null;
  const level = malicious == null || suspicious == null
    ? (vt.status === "pending" ? "pending" : "unknown")
    : malicious > 0 ? "malicious" : suspicious > 0 ? "suspicious" : "clean";
  const engines = vt.total ? `/${vt.total}` : "";
  const tone = {
    malicious: "border-status-error/30 bg-status-error/10",
    suspicious: "border-status-warning/30 bg-status-warning/10",
    clean: "border-status-success/30 bg-status-success/10",
    pending: "border-overlay/10 bg-overlay/[0.03]",
    unknown: "border-overlay/10 bg-overlay/[0.03]",
  }[level];
  const Icon = { malicious: ShieldAlert, suspicious: ShieldAlert, clean: ShieldCheck, pending: Clock, unknown: ShieldQuestion }[level];
  const iconColor = {
    malicious: "text-status-error",
    suspicious: "text-status-warning",
    clean: "text-status-success",
    pending: "text-text-muted",
    unknown: "text-text-muted",
  }[level];
  const context = [
    vt.architecture ? `${vt.architecture} ${gt("installer")}` : null,
    vt.scannedAt ? `${gt("analyzed")} ${dateLabel(vt.scannedAt)}` : null,
  ].filter(Boolean).join(", ");
  return (
    <a
      href={`https://www.virustotal.com/gui/file/${vt.hash}`}
      target="_blank"
      rel="noopener noreferrer"
      title={context || undefined}
      className={`inline-flex min-h-6 items-center gap-1.5 rounded-md border px-1.5 text-text-secondary hover:text-text-primary ${tone} ${focusRing}`}
    >
      <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      <span>
        {level === "pending" ? (
          <T>VirusTotal: analysis pending</T>
        ) : level === "unknown" ? (
          <T>VirusTotal: open report</T>
        ) : level === "malicious" ? (
          <T>VirusTotal: <Var>{malicious}</Var><Var>{engines}</Var> malicious</T>
        ) : level === "suspicious" ? (
          <T>VirusTotal: <Var>{suspicious}</Var><Var>{engines}</Var> suspicious</T>
        ) : (
          <T>VirusTotal: no detections <Var>{engines ? `(0${engines})` : ""}</Var></T>
        )}
      </span>
      {context && <span className="sr-only">({context})</span>}
    </a>
  );
}

function UpdateSizeBadge({ release }: { release: CatalogRelease }) {
  const size = updateSize(release.previous_version, release.version);
  if (!size) return null;
  const styles: Record<typeof size, string> = {
    major: "border-accent-cyan/30 bg-accent-cyan/10 text-text-primary",
    minor: "border-overlay/15 text-text-secondary",
    patch: "border-overlay/10 text-text-muted",
    lower: "border-status-warning/30 bg-status-warning/10 text-text-primary",
  };
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${styles[size]}`}>
      {size === "major" ? <T>Major</T> : size === "minor" ? <T>Minor</T> : size === "patch" ? <T>Patch</T> : <T>Lower version</T>}
    </span>
  );
}

export default async function CatalogReleasesPage({ searchParams }: Props) {
  const filters = parseHistoryFilters(await searchParams);
  const gt = await getGT();
  const filtered = hasActiveFilters(filters);
  const weekStart = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  const [result, recent] = await Promise.all([
    loadHistoryOrPartial(JSON.stringify(filters)),
    // Global activity for the unfiltered overview only; the tile is dropped if this fails.
    !filters.app && !filtered ? loadRecentUpdates(weekStart).catch(() => null) : null,
  ]);
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / PAGE_SIZE));
  if (result && filters.page > pages) {
    redirect(historyUrl(filters, pages));
  }
  const groups = new Map<string, NonNullable<typeof result>["rows"]>();
  for (const row of result?.rows ?? []) {
    const day = new Date(row.detected_at).toISOString().slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), row]);
  }
  const appName = filters.app ? result?.rows[0]?.name ?? filters.app : null;
  const sync = result?.sync;
  const completed = sync?.status === "success" || sync?.status === "partial";
  const syncRunning = sync?.status === "running" || sync?.status === "pending";
  const syncFailed = sync?.status === "failed" || sync?.status === "error";
  const status = sync?.status === "running"
    ? gt("Catalog sync in progress")
    : sync?.status === "pending" ? gt("Catalog sync queued")
    : syncFailed ? gt("Latest sync failed")
    : sync ? gt("Catalog sync has not completed") : gt("History from the catalog snapshot");
  const clearUrl = filters.app ? appHistoryUrl(filters.app) : "/apps/releases";
  const without = (patch: Partial<ReleaseHistoryFilters>) => historyUrl({ ...filters, ...patch }, 1);
  const kindLabel = filters.kind === "updated" ? gt("Version changes") : gt("First tracked");
  const chips = [
    filters.query && { label: `${gt("Search")}: ${filters.query}`, href: without({ query: "" }) },
    filters.month && { label: monthFormat.format(new Date(`${filters.month}-01T00:00:00Z`)), href: without({ month: "" }) },
    filters.kind !== "all" && { label: kindLabel, href: without({ kind: "all" }) },
    filters.from && { label: `${gt("From")} ${dateLabel(filters.from)}`, href: without({ from: undefined }) },
    filters.to && { label: `${gt("Through")} ${dateLabel(filters.to)}`, href: without({ to: undefined }) },
    filters.architecture && { label: filters.architecture, href: without({ architecture: undefined }) },
  ].filter((chip): chip is { label: string; href: string } => Boolean(chip));
  const stats: [string, number][] = result
    ? [
        [gt("Versions recorded"), result.total] as [string, number],
        // A record-type filter makes this tile equal the total (or zero).
        ...(filters.kind === "all" ? [[gt("Version changes"), result.total - result.firstTracked] as [string, number]] : []),
        ...(filters.app ? [] : [[gt("Apps"), result.apps] as [string, number]]),
        ...(recent != null ? [[gt("Updates in the last 7 days"), recent] as [string, number]] : []),
      ]
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-bg-deepest">
      <Header />
      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-24 lg:px-8 lg:pt-28"
      >
        <header className="mb-6">
          <nav aria-label={gt("Breadcrumb")} className="mb-4 text-sm">
            <ol className="flex flex-wrap items-center gap-1.5 text-text-muted">
              <li><Link href="/apps" className={`text-accent-cyan hover:underline ${focusRing}`}><T>App catalog</T></Link></li>
              <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
              {filters.app ? (
                <>
                  <li><Link href="/apps/releases" className={`text-accent-cyan hover:underline ${focusRing}`}><T>Release history</T></Link></li>
                  <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
                  <li aria-current="page" className="break-all text-text-secondary">{appName}</li>
                </>
              ) : (
                <li aria-current="page" className="text-text-secondary"><T>Release history</T></li>
              )}
            </ol>
          </nav>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0 max-w-3xl">
              <h1 className="text-balance text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
                {appName ? (
                  <>
                    <span className="mb-1 block text-sm font-medium text-text-muted"><T>Version history</T></span>
                    <span className="break-words">{appName}</span>
                  </>
                ) : (
                  <T>WinGet app release history</T>
                )}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-text-secondary sm:text-lg">
                {appName ? (
                  <T>
                    Every version of <Var>{appName}</Var> that IntuneGet has recorded
                    from WinGet, newest first.
                  </T>
                ) : (
                  <T>
                    Every app update IntuneGet records from WinGet, with release
                    notes, installer hashes, and VirusTotal results where available.
                  </T>
                )}
              </p>
            </div>
            {filters.app && (
              <Link
                href={`/apps/${encodeURIComponent(filters.app)}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent-cyan px-5 py-2 text-sm font-semibold text-bg-deepest hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-cyan"
              >
                <T>Deploy with IntuneGet</T>
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
            {result && !completed && (
              <span className="inline-flex items-center gap-2 font-medium text-text-secondary">
                <span aria-hidden="true" className="relative flex h-2 w-2">
                  {syncRunning && <span className="absolute inline-flex h-full w-full rounded-full bg-status-warning opacity-75 motion-safe:animate-ping" />}
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${syncFailed ? "bg-status-error" : syncRunning ? "bg-status-warning" : "bg-text-muted"}`} />
                </span>
                {status}
              </span>
            )}
            {result && (
              <span>
                <T>Last full catalog check:</T>{" "}
                {sync?.lastSuccessfulAt ? (
                  <time dateTime={sync.lastSuccessfulAt}>
                    {syncDateFormat.format(new Date(sync.lastSuccessfulAt))}
                  </time>
                ) : (
                  <T>not yet recorded</T>
                )}
                {!completed && sync?.completedAt && sync.completedAt !== sync.lastSuccessfulAt && (
                  <>
                    {" · "}<T>Last attempt:</T>{" "}
                    <time dateTime={sync.completedAt}>{syncDateFormat.format(new Date(sync.completedAt))}</time>
                  </>
                )}
              </span>
            )}
            <span><T>All dates are UTC</T></span>
            <ReleaseFeedDialog key={filters.app ?? "all"} app={filters.app} />
          </div>
        </header>

        {result && (
          <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-overlay/10 bg-overlay/10 sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none">
            {stats.map(([label, value]) => (
              <div key={label} className="bg-bg-elevated px-3 py-2.5 sm:px-5 sm:py-3">
                <dt className="text-xs text-text-secondary sm:text-sm">
                  <T><Var>{label}</Var></T>
                </dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums text-text-primary sm:text-2xl">
                  {Number(value).toLocaleString("en-US")}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* Collapsed on small screens only. Browsers without ::details-content keep the summary on desktop too. */}
        <details className={`group/filters ${filtered ? "mb-4" : "mb-6"} rounded-xl border border-overlay/10 bg-bg-elevated lg:details-content:[content-visibility:visible]`}>
          <summary className={`flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-4 text-sm font-medium text-text-primary [&::-webkit-details-marker]:hidden supports-[selector(::details-content)]:lg:hidden ${focusRing}`}>
            <Search aria-hidden="true" className="h-4 w-4 text-text-muted" />
            <T>Search and filter</T>
            {chips.length > 0 && (
              <span className="rounded-full bg-accent-cyan/15 px-2 py-0.5 text-xs tabular-nums text-text-primary">
                <T><Var>{chips.length}</Var> active</T>
              </span>
            )}
            <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 text-text-muted transition-transform group-open/filters:rotate-180" />
          </summary>
          <form
            action="/apps/releases"
            className="grid grid-cols-2 gap-3 border-t border-overlay/10 p-4 supports-[selector(::details-content)]:lg:border-t-0 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
          >
            {filters.app && <input type="hidden" name="app" value={filters.app} />}
            <div className="col-span-2 lg:col-span-1">
              <label
                htmlFor="history-search"
                className="mb-1.5 block text-sm font-medium text-text-primary"
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
                  placeholder={gt("Name, publisher, or WinGet ID…")}
                  className={`${control} pl-10`}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="history-month"
                className="mb-1.5 block text-sm font-medium text-text-primary"
              >
                <T>Month</T>
              </label>
              <select
                id="history-month"
                name="month"
                defaultValue={filters.month}
                className={control}
              >
                <option value="">{gt("All months")}</option>
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
                      {monthFormat.format(new Date(`${month}-01T00:00:00Z`))}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="history-kind"
                className="mb-1.5 block text-sm font-medium text-text-primary"
              >
                <T>Record type</T>
              </label>
              <select
                id="history-kind"
                name="kind"
                defaultValue={filters.kind}
                className={control}
              >
                <option value="all">{gt("All records")}</option>
                <option value="updated">{gt("Version changes")}</option>
                <option value="first">{gt("First tracked")}</option>
              </select>
            </div>
            <button
              type="submit"
              className="col-span-2 min-h-11 rounded-lg bg-accent-cyan px-6 py-2 text-sm font-semibold text-bg-deepest hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-cyan lg:col-span-1"
            >
              <T>Apply filters</T>
            </button>
            <details open={Boolean(filters.from || filters.to || filters.architecture)} className="col-span-2 lg:col-span-4">
              <summary className="w-fit cursor-pointer py-1 text-sm font-medium text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-cyan"><T>Date range and architecture</T></summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {[['from', gt('Recorded from')], ['to', gt('Recorded through')]].map(([key, label]) => (
                  <div key={key}>
                    <label htmlFor={`history-${key}`} className="mb-1.5 block text-sm font-medium text-text-primary"><T><Var>{label}</Var></T></label>
                    <input id={`history-${key}`} name={key} type="date" defaultValue={key === 'from' ? filters.from : filters.to} className={control} />
                  </div>
                ))}
                <div>
                  <label htmlFor="history-architecture" className="mb-1.5 block text-sm font-medium text-text-primary"><T>Installer architecture</T></label>
                  <select id="history-architecture" name="architecture" defaultValue={filters.architecture ?? ''} className={control}>
                    <option value="">{gt("All architectures")}</option>
                    {['x64', 'x86', 'arm64', 'arm', 'neutral'].map(value => <option key={value} value={value}>{value}</option>)}
                  </select>
                </div>
              </div>
            </details>
          </form>
        </details>
        {filtered && (
          <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span><T>Filtered by:</T></span>
            <ul className="contents">
              {chips.map(chip => (
                <li key={chip.label}>
                  <Link
                    href={chip.href}
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-overlay/15 bg-bg-elevated px-3 text-text-secondary hover:border-overlay/30 hover:text-text-primary ${focusRing}`}
                  >
                    <span className="break-all">{chip.label}</span>
                    <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    <span className="sr-only"><T>Remove filter</T></span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href={clearUrl}
              className={`inline-flex min-h-8 items-center font-medium text-text-secondary underline decoration-overlay/20 underline-offset-4 hover:decoration-current ${focusRing}`}
            >
              <T>Clear all</T>
            </Link>
          </div>
        )}

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
          <div className="space-y-6">
            {[...groups].map(([day, rows]) => (
              <section
                key={day}
                aria-labelledby={`day-${day}`}
                className="grid gap-2 lg:grid-cols-[130px_1fr] lg:gap-3"
              >
                <h2
                  id={`day-${day}`}
                  className="sticky top-16 z-10 -mx-4 bg-bg-deepest/95 px-4 py-2 text-sm font-semibold text-text-secondary backdrop-blur lg:top-24 lg:mx-0 lg:self-start lg:bg-transparent lg:px-0 lg:pt-3 lg:backdrop-blur-none"
                >
                  <span className="sr-only"><T>Recorded on</T> </span>
                  <time dateTime={day}>{dayFormat.format(new Date(day))}</time>
                </h2>
                <ul className="min-w-0 divide-y divide-overlay/10 rounded-xl border border-overlay/10 bg-bg-elevated">
                  {rows.map((row) => (
                    <li
                      key={`${row.winget_id}:${row.version}`}
                      className="flex min-w-0 gap-3 px-4 py-3 first:rounded-t-xl last:rounded-b-xl hover:bg-overlay/[0.025] focus-within:bg-overlay/[0.025]"
                    >
                      <div className="shrink-0 pt-0.5" aria-hidden="true">
                        <AppIcon packageId={row.winget_id} packageName={row.name} size="sm" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <Link
                              href={`/apps/${encodeURIComponent(row.winget_id)}`}
                              className={`break-words text-[15px] font-semibold leading-6 text-text-primary hover:underline ${focusRing}`}
                            >
                              {row.name}
                            </Link>
                            {row.previous_version ? (
                              <UpdateSizeBadge release={row} />
                            ) : (
                              <span className="rounded-md border border-overlay/10 px-1.5 py-0.5 text-[10px] text-text-secondary">
                                <T>First tracked</T>
                              </span>
                            )}
                          </div>
                          <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs tabular-nums sm:max-w-72 sm:justify-end">
                            {row.previous_version && (
                              <>
                                <span className="break-all text-text-muted">
                                  {row.previous_version}
                                </span>
                                <span className="sr-only"><T>to</T></span>
                                <ArrowRight
                                  aria-hidden="true"
                                  className="h-3 w-3 shrink-0 text-text-muted"
                                />
                              </>
                            )}
                            <span className="break-all rounded-md border border-overlay/10 bg-overlay/[0.03] px-2 py-0.5 font-semibold text-text-primary">
                              {row.version}
                            </span>
                          </div>
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-text-muted">
                          <span className="break-all">{row.winget_id}</span>
                          {row.release_date && (
                            <span className="inline-flex items-center gap-1.5">
                              <CalendarDays aria-hidden="true" className="h-3 w-3 shrink-0" />
                              <span>
                                <T>Vendor released</T>{" "}
                                <time dateTime={row.release_date}>{dateLabel(row.release_date)}</time>
                              </span>
                            </span>
                          )}
                          <VirusTotalStatus release={row} gt={gt} />
                          {!filters.app && (
                            <Link href={appHistoryUrl(row.winget_id)} className={metaLink}>
                              <T>Version history</T>
                            </Link>
                          )}
                          {row.release_notes_url && (
                            <a
                              href={row.release_notes_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={metaLink}
                            >
                              <T>Release notes</T>
                              <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                            </a>
                          )}
                          <details className="min-w-0 open:basis-full">
                            <summary className="w-fit cursor-pointer py-1 font-medium text-text-secondary hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent-cyan"><T>Details</T></summary>
                            <div className="mt-2 space-y-3 rounded-lg border border-overlay/10 bg-bg-deepest p-3">
                              <p><T>Recorded by IntuneGet:</T> <time dateTime={row.detected_at}>{syncDateFormat.format(new Date(row.detected_at))}</time></p>
                              {row.virusTotal?.scannedAt && <p><T>VirusTotal analyzed:</T> <time dateTime={row.virusTotal.scannedAt}>{syncDateFormat.format(new Date(row.virusTotal.scannedAt))}</time></p>}
                              <p><T>Source: WinGet manifest. Findings above apply only to the matching installer hash.</T></p>
                              {(row.installers?.length ? row.installers : row.virusTotal ? [{hash: row.virusTotal.hash, architecture: row.virusTotal.architecture, filename: null, type: null}] : []).map((installer, index) => (
                                <div key={`${installer.hash}:${index}`} className="border-t border-overlay/10 pt-3">
                                  <p className="break-all font-medium text-text-secondary">{installer.filename ?? 'Installer'}{installer.architecture ? ` (${installer.architecture})` : ''}{installer.type ? ` · ${installer.type}` : ''}</p>
                                  {installer.hash === row.virusTotal?.hash && <p className="mt-1"><T>Installer shown in the scan summary</T></p>}
                                  <p className="mt-1 break-all font-mono select-all">SHA-256: {installer.hash}</p>
                                  <a href={`https://www.virustotal.com/gui/file/${installer.hash}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-6 items-center text-accent-cyan hover:underline"><T>Open this file’s report</T></a>
                                </div>
                              ))}
                              {!row.installers?.length && !row.virusTotal && <p><T>Installer details are unavailable for this record.</T></p>}
                            </div>
                          </details>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {result && (pages > 1 || filters.page > 1) && (
          <div className="mt-10 flex flex-col items-center gap-5">
            <nav aria-label={gt("Release history pagination")}>
              <ul className="flex flex-wrap items-center justify-center gap-1 text-sm">
                {filters.page > 1 && (
                  <li>
                    <Link
                      href={historyUrl(filters, filters.page - 1)}
                      rel="prev"
                      className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-accent-cyan hover:bg-overlay/[0.04] ${focusRing}`}
                    >
                      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                      <T>Newer</T>
                    </Link>
                  </li>
                )}
                {pageWindow(filters.page, pages).map((page, index) =>
                  page === "gap" ? (
                    <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-text-muted">…</li>
                  ) : (
                    <li key={page}>
                      <Link
                        href={historyUrl(filters, page)}
                        aria-current={page === filters.page ? "page" : undefined}
                        className={`inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg px-2 tabular-nums ${focusRing} ${
                          page === filters.page
                            ? "bg-accent-cyan font-semibold text-bg-deepest"
                            : "text-text-secondary hover:bg-overlay/[0.04] hover:text-text-primary"
                        }`}
                      >
                        <span className="sr-only"><T>Page</T> </span>
                        {page.toLocaleString("en-US")}
                      </Link>
                    </li>
                  ),
                )}
                {filters.page < pages && (
                  <li>
                    <Link
                      href={historyUrl(filters, filters.page + 1)}
                      rel="next"
                      className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-3 text-accent-cyan hover:bg-overlay/[0.04] ${focusRing}`}
                    >
                      <T>Older</T>
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </li>
                )}
              </ul>
            </nav>
            <form action="/apps/releases" className="flex flex-wrap items-end justify-center gap-2 text-sm">
              {(["app", "from", "architecture"] as const).map(key => filters[key] && <input key={key} type="hidden" name={key} value={filters[key]} />)}
              {filters.query && <input type="hidden" name="q" value={filters.query} />}
              {filters.month && <input type="hidden" name="month" value={filters.month} />}
              {filters.kind !== "all" && <input type="hidden" name="kind" value={filters.kind} />}
              <div>
                <label htmlFor="history-jump" className="mb-1.5 block font-medium text-text-secondary"><T>Jump to date</T></label>
                <input id="history-jump" name="to" type="date" required defaultValue={filters.to} className={`${control} w-auto`} />
              </div>
              <button type="submit" className={`min-h-11 rounded-lg border border-overlay/15 px-4 font-medium text-text-primary hover:bg-overlay/[0.04] ${focusRing}`}>
                <T>Go</T>
              </button>
            </form>
          </div>
        )}

        <aside className="mt-14 flex flex-col gap-4 rounded-xl border border-accent-cyan/20 bg-accent-cyan/[0.06] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              <T>Keep these apps current in Intune</T>
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">
              <T>
                IntuneGet packages WinGet apps for Intune and can roll out new
                versions automatically with update policies.
              </T>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Link
              href="/auth/signin"
              className="inline-flex min-h-11 items-center rounded-lg bg-accent-cyan px-5 py-2 text-sm font-semibold text-bg-deepest hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent-cyan"
            >
              <T>Get started</T>
            </Link>
            <Link href="/docs/updates-policies" className={`inline-flex min-h-11 items-center text-sm font-medium text-text-secondary hover:text-text-primary hover:underline ${focusRing}`}>
              <T>How update policies work</T>
            </Link>
          </div>
        </aside>

        <aside className="mt-10 border-t border-overlay/10 pt-6 text-sm leading-relaxed text-text-muted">
          <h2 className="font-semibold text-text-secondary">
            <T>About this history</T>
          </h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>
              <T>
                This is an observation history, not a complete archive of
                publisher releases. Versions released between catalog checks may
                be missing, and a version change can also reflect an upstream
                rollback.
              </T>
            </li>
            <li>
              <T>
                First tracked marks the earliest version IntuneGet recorded for an
                app, including apps imported when tracking began. It does not
                necessarily mean a newly released product.
              </T>
            </li>
            <li>
              <T>
                VirusTotal results are cached analyses of the exact WinGet
                installer hash, as of the date shown. Opening a report does not
                request a new scan, a report may not exist yet, and zero
                detections do not guarantee safety.
              </T>
            </li>
            <li>
              <T>
                Update size compares version numbers only and is shown when both
                versions are numeric.
              </T>
            </li>
            <li>
              <T>Vendor release dates appear only when the WinGet manifest provides them.</T>
              {result?.coverageStart && (
                <>
                  {" "}<T>Records begin</T>{" "}
                  <time dateTime={result.coverageStart}>{dateLabel(result.coverageStart)}</time>.
                </>
              )}
            </li>
          </ul>
        </aside>
      </main>
      <Footer />
    </div>
  );
}
