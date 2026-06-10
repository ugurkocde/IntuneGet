import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCategories } from '@/lib/winget-api';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          error:
            'App catalog requires a configured Supabase database. See docs/SELF_HOSTING.md - the catalog is not available in standalone SQLite mode.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const categories = await getCategories();

    // Get actual total count of verified apps (not just sum of categories)
    let totalApps = categories.reduce((sum, cat) => sum + cat.count, 0);

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { count } = await supabase
      .from('curated_apps')
      .select('*', { count: 'exact', head: true })
      .eq('is_verified', true);

    if (count !== null) {
      totalApps = count;
    }

    return NextResponse.json({
      count: categories.length,
      totalApps,
      categories,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
