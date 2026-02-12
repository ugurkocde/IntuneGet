import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Return zeros if Supabase not configured (self-hosted)
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { signinClicks: 0, appsDeployed: 0, appsSupported: 0 },
        { headers: NO_STORE_HEADERS }
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
      return NextResponse.json({ signinClicks: 0, appsDeployed: 0, appsSupported: 0 }, { headers: NO_STORE_HEADERS });
    }

    const stats = {
      signinClicks: countersResult.data?.find((row) => row.id === 'signin_clicks')?.value ?? 0,
      appsDeployed: countersResult.data?.find((row) => row.id === 'apps_deployed')?.value ?? 0,
      appsSupported: curatedAppsResult.count ?? 0,
    };

    return NextResponse.json(stats, {
      headers: NO_STORE_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { signinClicks: 0, appsDeployed: 0, appsSupported: 0 },
      { headers: NO_STORE_HEADERS }
    );
  }
}
