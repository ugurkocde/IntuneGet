import { NextResponse } from 'next/server';
import { getGitHubRepoStats } from '@/lib/stats/github-stats';

/**
 * Same-origin proxy for GitHub repo stats. The underlying fetches use the
 * server fetch cache (1 hour), so this stays a single upstream request per
 * revalidation window regardless of client traffic - and clients avoid
 * api.github.com CORS failures and per-IP rate limits.
 */
export async function GET() {
  const stats = await getGitHubRepoStats();
  return NextResponse.json(stats, {
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=3600',
    },
  });
}
