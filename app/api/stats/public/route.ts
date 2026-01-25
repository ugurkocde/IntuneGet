import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// In-memory cache
let cache: { data: { signinClicks: number; appsDeployed: number; appsSupported: number }; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 60 seconds

export async function GET() {
  try {
    // Check cache first
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      console.log('[stats/public] Returning cached data:', cache.data);
      return NextResponse.json(cache.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    console.log('[stats/public] Supabase URL configured:', !!supabaseUrl);
    console.log('[stats/public] Supabase Anon Key configured:', !!supabaseAnonKey);

    // Return zeros if Supabase not configured (self-hosted)
    if (!supabaseUrl || !supabaseAnonKey) {
      console.log('[stats/public] Supabase not configured, returning zeros');
      return NextResponse.json(
        { signinClicks: 0, appsDeployed: 0, appsSupported: 0 },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
          },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Fetch site counters and curated apps count in parallel
    console.log('[stats/public] Fetching from Supabase...');
    const [countersResult, curatedAppsResult] = await Promise.all([
      supabase
        .from('site_counters')
        .select('id, count')
        .in('id', ['signin_clicks', 'apps_deployed']),
      supabase
        .from('curated_apps')
        .select('*', { count: 'exact', head: true }),
    ]);

    console.log('[stats/public] Counters result:', {
      data: countersResult.data,
      error: countersResult.error,
      status: countersResult.status,
    });
    console.log('[stats/public] Curated apps result:', {
      count: curatedAppsResult.count,
      error: curatedAppsResult.error,
      status: curatedAppsResult.status,
    });

    if (countersResult.error) {
      console.error('[stats/public] Error fetching counters:', countersResult.error);
      // Return cached data if available, otherwise zeros
      return NextResponse.json(
        cache?.data ?? { signinClicks: 0, appsDeployed: 0, appsSupported: 0 },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
          },
        }
      );
    }

    if (curatedAppsResult.error) {
      console.error('[stats/public] Error fetching curated apps count:', curatedAppsResult.error);
    }

    const stats = {
      signinClicks: countersResult.data?.find((row) => row.id === 'signin_clicks')?.count ?? 0,
      appsDeployed: countersResult.data?.find((row) => row.id === 'apps_deployed')?.count ?? 0,
      appsSupported: curatedAppsResult.count ?? 0,
    };

    console.log('[stats/public] Final stats:', stats);

    // Update cache
    cache = { data: stats, timestamp: Date.now() };

    return NextResponse.json(stats, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error('[stats/public] Unexpected error:', error);
    return NextResponse.json(
      { signinClicks: 0, appsDeployed: 0, appsSupported: 0 },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      }
    );
  }
}
