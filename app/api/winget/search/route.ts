import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';

export const runtime = 'edge';
export const fetchCache = 'force-no-store';

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
  rank: number;
  app_source: string | null;
  store_package_id: string | null;
}

// Search curated apps
async function searchCachedPackages(
  query: string,
  limit: number,
  category?: string | null,
  sort: string = 'popular'
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  const { data: curatedData, error: curatedError } = await getCatalogSource().searchApps(
    query,
    { limit, category: category || null }
  );

  if (curatedError) {
    return null;
  }

  if (curatedData && curatedData.length > 0) {
    let results = curatedData as CuratedAppResult[];

    // Apply secondary sorting if requested
    if (sort === 'name') {
      results = results.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'newest') {
      // newest first by id (higher id = newer entry)
      results = results.sort((a, b) => b.id - a.id);
    }
    // 'popular' keeps the RPC's default relevance + popularity ordering

    return {
      source: 'curated',
      data: results,
    };
  }

  return null;
}

export async function GET(request: NextRequest) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error:
            'App catalog requires a configured Supabase database. See docs/SELF_HOSTING.md - the catalog is not available in standalone SQLite mode.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const category = searchParams.get('category');
    const sort = searchParams.get('sort') || 'popular';

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        {
          error:
            'Query parameter "q" is required and must be at least 2 characters',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const sanitizedLimit = Math.min(limit, 100);

    // Try curated apps search first
    const cachedResults = await searchCachedPackages(
      query,
      sanitizedLimit,
      category,
      sort
    );

    if (cachedResults && cachedResults.data.length > 0) {
      const curatedData = cachedResults.data;
      return NextResponse.json({
        query,
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
          appSource: p.app_source === 'store' ? 'store' : 'win32',
          packageIdentifier: p.store_package_id || undefined,
        })),
        source: 'curated',
      }, {
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      });
    }

    // No results found - the enhanced search_curated_apps function already tried
    // both FTS and ILIKE fallback, so return empty results
    return NextResponse.json({
      query,
      count: 0,
      packages: [],
      source: 'curated',
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to search packages' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
