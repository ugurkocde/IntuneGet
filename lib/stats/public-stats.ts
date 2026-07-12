import 'server-only';
import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { getCatalogSource } from '@/lib/catalog';

export interface PublicLandingStats {
  signinClicks: number;
  appsDeployed: number;
  appsSupported: number;
}

const ZERO_STATS: PublicLandingStats = {
  signinClicks: 0,
  appsDeployed: 0,
  appsSupported: 0,
};

/**
 * Fetches the public landing page counters (sign-in clicks, deployed apps)
 * from Supabase plus the supported app count from the active catalog source.
 * Returns zeros when Supabase is not configured (self-hosted) or on any error.
 *
 * Cached for 30 seconds: the landing page renders dynamically on every
 * request (gt-next cookie-mode locale) and /api/stats/public is polled every
 * 8-20s per visitor, so without this cache every hit triggered a Supabase
 * query plus a catalog stats scan. 30s keeps the live counters fresh while
 * bounding backend load to ~2 queries/minute per server instance.
 */
export const getPublicLandingStats = unstable_cache(
  fetchPublicLandingStats,
  ['public-landing-stats'],
  { revalidate: 30 },
);

async function fetchPublicLandingStats(): Promise<PublicLandingStats> {
  // The catalog count does not depend on Supabase (self-hosted installs use
  // the local snapshot), so fetch it independently of the counters.
  let appsSupported = 0;
  try {
    appsSupported = (await getCatalogSource().getCatalogStats()).totalApps;
  } catch {
    appsSupported = 0;
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Counters live in Supabase; without it (self-hosted) they stay at zero
    if (!supabaseUrl || !supabaseServiceKey) {
      return { ...ZERO_STATS, appsSupported };
    }

    // Use service role key to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const countersResult = await supabase
      .from('site_counters')
      .select('*')
      .in('id', ['signin_clicks', 'apps_deployed']);

    if (countersResult.error) {
      return { ...ZERO_STATS, appsSupported };
    }

    return {
      signinClicks: countersResult.data?.find((row) => row.id === 'signin_clicks')?.value ?? 0,
      appsDeployed: countersResult.data?.find((row) => row.id === 'apps_deployed')?.value ?? 0,
      appsSupported,
    };
  } catch {
    return { ...ZERO_STATS, appsSupported };
  }
}

/**
 * Formats an app count as the exact live value with en-US grouping
 * (13,645 -> "13,645+"). One convention across every public surface: the
 * hero, /apps, and JSON-LD all show the same number. Returns an empty string
 * when the count is 0 so callers can fall back to count-free phrasing.
 */
export function formatAppCountLabel(count: number): string {
  if (count <= 0) {
    return '';
  }

  return `${count.toLocaleString('en-US')}+`;
}
