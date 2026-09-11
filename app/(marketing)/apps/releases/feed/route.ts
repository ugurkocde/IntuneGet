import { unstable_cache } from "next/cache";
import { getCatalogSource } from "@/lib/catalog";
import { parseHistoryFilters } from "@/lib/catalog/release-history";
import { releaseFeed } from "@/lib/catalog/release-feed";

const loadFeed = unstable_cache(
  (app: string) => getCatalogSource().getReleaseHistory(parseHistoryFilters({ app })),
  ["catalog-release-feed-v1"], { revalidate: 300 },
);
export async function GET(request: Request) {
  const { app = "" } = parseHistoryFilters({ app: new URL(request.url).searchParams.get("app") ?? "" });
  try {
    const result = await loadFeed(app);
    return new Response(releaseFeed(result.rows, app), { headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Release feed is temporarily unavailable. Please retry.", {
      status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" },
    });
  }
}
