import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// In-memory cache
let cache: { data: { signinClicks: number; appsDeployed: number; appsSupported: number }; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 60 seconds

export async function GET() {
  try {
    // Check cache first
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      return NextResponse.json(cache.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Return zeros if Supabase not configured (self-hosted)
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { signinClicks: 0, appsDeployed: 0, appsSupported: 0 },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
          },
        }
      );
    }

    // Use service role key to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch site counters and curated apps count in parallel
    const [countersResult, curatedAppsResult] = await Promise.all([
      supabase
        .from('site_counters')
        .select('*')
        .in('id', ['signin_clicks', 'apps_deployed']),
      supabase
        .from('curated_apps')
        .select('*', { count: 'exact', head: true }),
    ]);

    if (countersResult.error) {
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

    const stats = {
      signinClicks: countersResult.data?.find((row) => row.id === 'signin_clicks')?.value ?? 0,
      appsDeployed: countersResult.data?.find((row) => row.id === 'apps_deployed')?.value ?? 0,
      appsSupported: curatedAppsResult.count ?? 0,
    };

    // Update cache
    cache = { data: stats, timestamp: Date.now() };

    return NextResponse.json(stats, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    });
  } catch {
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
