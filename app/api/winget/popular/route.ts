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
  installer_type: string | null;
}

// Get popular packages from curated apps
async function getCachedPopularPackages(
  limit: number,
  offset: number = 0,
  category?: string | null,
  sort: string = 'popular'
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // For non-popular sorts, query the table directly with appropriate ORDER BY
  if (sort === 'name' || sort === 'newest') {
    let query = supabase
      .from('curated_apps')
      .select('id, winget_id, name, publisher, latest_version, description, homepage, category, tags, icon_path, popularity_rank, installer_type');

    if (category) {
      query = query.eq('category', category);
    }

    if (sort === 'name') {
      query = query.order('name', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      return null;
    }

    return {
      source: 'curated',
      data: data as CuratedAppResult[],
    };
  }

  // Default: use RPC for popularity-based sorting
  const { data: curatedData, error: curatedError } = await supabase.rpc(
    'get_popular_curated_apps',
    {
      result_limit: limit,
      result_offset: offset,
      category_filter: category || null,
    }
  );

  if (curatedError) {
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
    const sort = searchParams.get('sort') || 'popular';
    const sanitizedLimit = Math.min(limit, 50);
    const sanitizedOffset = Math.max(offset, 0);

    // Try curated popular packages first
    const cachedResult = await getCachedPopularPackages(sanitizedLimit, sanitizedOffset, category, sort);

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
          installerType: p.installer_type,
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
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch popular packages' },
      { status: 500 }
    );
  }
}
