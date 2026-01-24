import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPopularPackages } from '@/lib/winget-api';

export const runtime = 'edge';

interface CuratedAppResult {
  id: number;
  winget_id: string;
  name: string;
  publisher: string;
  latest_version: string;
  description: string | null;
  homepage: string | null;
  category: string | null;
  tags: string[] | null;
  icon_path: string | null;
  popularity_rank: number | null;
  chocolatey_downloads: number | null;
}

// Get popular packages from curated apps
async function getCachedPopularPackages(limit: number, offset: number = 0, category?: string | null) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: curatedData, error: curatedError } = await supabase.rpc(
    'get_popular_curated_apps',
    {
      result_limit: limit,
      result_offset: offset,
      category_filter: category || null,
    }
  );

  if (curatedError) {
    console.error('Cache popular packages error:', curatedError);
    return null;
  }

  if (curatedData && curatedData.length > 0) {
    return {
      source: 'curated',
      data: curatedData as CuratedAppResult[],
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const category = searchParams.get('category');
    const sanitizedLimit = Math.min(limit, 50);
    const sanitizedOffset = Math.max(offset, 0);

    // Try curated popular packages first
    const cachedResult = await getCachedPopularPackages(sanitizedLimit, sanitizedOffset, category);

    if (cachedResult && cachedResult.data.length > 0) {
      const curatedData = cachedResult.data;
      return NextResponse.json({
        count: curatedData.length,
        packages: curatedData.map((p) => ({
          id: p.winget_id,
          name: p.name,
          publisher: p.publisher,
          version: p.latest_version || '',
          description: p.description,
          homepage: p.homepage,
          tags: p.tags || [],
          category: p.category,
          iconPath: p.icon_path,
          popularityRank: p.popularity_rank,
          chocolateyDownloads: p.chocolatey_downloads,
        })),
        source: 'curated',
      });
    }

    // Fall back to lib/winget-api
    const packages = await getPopularPackages(sanitizedLimit, category || undefined);

    return NextResponse.json({
      count: packages.length,
      packages,
      source: 'api',
    });
  } catch (error) {
    console.error('Popular packages fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch popular packages' },
      { status: 500 }
    );
  }
}
