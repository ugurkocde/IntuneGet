import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCategories } from '@/lib/winget-api';

export const runtime = 'edge';

export async function GET() {
  try {
    const categories = await getCategories();

    // Get actual total count of verified apps (not just sum of categories)
    let totalApps = categories.reduce((sum, cat) => sum + cat.count, 0);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { count } = await supabase
        .from('curated_apps')
        .select('*', { count: 'exact', head: true })
        .eq('is_verified', true);

      if (count !== null) {
        totalApps = count;
      }
    }

    return NextResponse.json({
      count: categories.length,
      totalApps,
      categories,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}
