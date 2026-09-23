export interface ReleaseHistoryFilters {
  query: string;
  month: string;
  kind: "all" | "first" | "updated";
  page: number;
  app?: string;
  from?: string;
  to?: string;
  architecture?: string;
}
export interface CatalogRelease {
  winget_id: string;
  name: string;
  publisher: string | null;
  version: string;
  previous_version: string | null;
  detected_at: string;
  release_date: string | null;
  release_notes_url?: string | null;
  detailsUnavailable?: boolean;
  installers?: { hash: string; architecture: string | null; filename: string | null; type: string | null }[];
  virusTotal?: {
    status: string;
    hash: string;
    architecture: string | null;
    malicious: number | null;
    suspicious: number | null;
    total: number | null;
    scannedAt: string | null;
  } | null;
}
export interface ReleaseHistoryResult {
  rows: CatalogRelease[];
  total: number;
  apps: number;
  firstTracked: number;
  months: string[];
  coverageStart: string | null;
  sync: {
    status: string;
    completedAt: string | null;
    lastSuccessfulAt: string | null;
  } | null;
}
export function parseHistoryFilters(
  params: Record<string, string | string[] | undefined>,
): ReleaseHistoryFilters {
  const one = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const month = one("month");
  const kind = one("kind");
  const page = Number(one("page") || 1);
  const date = (key: string) => {
    const value = one(key);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : "";
  };
  const from = date("from");
  const to = date("to");
  const architecture = one("architecture");
  return {
    ...(one("app") ? { app: one("app").trim().slice(0, 120) } : {}),
    ...(from ? { from } : {}),
    ...(to && (!from || to >= from) ? { to } : {}),
    ...(["x64", "x86", "arm64", "arm", "neutral"].includes(architecture) ? { architecture } : {}),
    query: one("q").trim().slice(0, 120),
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "",
    kind: kind === "first" || kind === "updated" ? kind : "all",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10000) : 1,
  };
}
export function historyUrl(
  filters: ReleaseHistoryFilters,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const key of ["app", "from", "to", "architecture"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (filters.query) params.set("q", filters.query);
  if (filters.month) params.set("month", filters.month);
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (page > 1) params.set("page", String(page));
  return `/apps/releases${params.size ? `?${params}` : ""}`;
}

export function appHistoryUrl(app: string): string {
  return historyUrl({ query: "", month: "", kind: "all", page: 1, app }, 1);
}

export function hasActiveFilters(filters: ReleaseHistoryFilters): boolean {
  return Boolean(filters.query || filters.month || filters.from || filters.to || filters.architecture || filters.kind !== "all");
}

export type UpdateSize = "major" | "minor" | "patch" | "lower";

/** Classifies a version change by its first differing numeric segment. Returns
 * null when the versions are not comparable (non-numeric or date-style schemes). */
export function updateSize(previous: string | null, next: string): UpdateSize | null {
  const parse = (version: string) => {
    const parts = version.trim().replace(/^v/i, "").split(".").map(part => /^\d+/.exec(part)?.[0]);
    return parts.every((part): part is string => part !== undefined) ? parts.map(Number) : null;
  };
  const before = previous ? parse(previous) : null;
  const after = parse(next);
  if (!before || !after) return null;
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = before[i] ?? 0;
    const b = after[i] ?? 0;
    if (a === b) continue;
    if (b < a) return "lower";
    // A changed year-like leading segment (2025.x -> 2026.x) says nothing about scope.
    if (i === 0) return a >= 1000 || b >= 1000 ? null : "major";
    return i === 1 ? "minor" : "patch";
  }
  return null;
}

/** Page numbers to link around the current page, with "gap" for elided ranges. */
export function pageWindow(current: number, total: number): (number | "gap")[] {
  const pages = [...new Set([1, current - 1, current, current + 1, total])]
    .filter(page => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  return pages.flatMap((page, index) =>
    index > 0 && page - pages[index - 1] > 1 ? (["gap", page] as const) : [page],
  );
}
