export interface ReleaseHistoryFilters {
  query: string;
  month: string;
  kind: "all" | "first" | "updated";
  page: number;
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
  return {
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
  if (filters.query) params.set("q", filters.query);
  if (filters.month) params.set("month", filters.month);
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (page > 1) params.set("page", String(page));
  return `/apps/releases${params.size ? `?${params}` : ""}`;
}
