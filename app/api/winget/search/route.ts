import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { searchPackages } from '@/lib/winget-api';

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
  rank: number;
}

// Search curated apps
async function searchCachedPackages(
  query: string,
  limit: number,
  category?: string | null
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: curatedData, error: curatedError } = await supabase.rpc(
    'search_curated_apps',
    {
      search_query: query,
      category_filter: category || null,
      result_limit: limit,
    }
  );

  if (curatedError) {
    console.error('Cache search error:', curatedError);
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
    const query = searchParams.get('q') || searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const category = searchParams.get('category');

    if (!query || query.trim().length < 2) {
      return NextResponse.json(
        {
          error:
            'Query parameter "q" is required and must be at least 2 characters',
        },
        { status: 400 }
      );
    }

    const sanitizedLimit = Math.min(limit, 100);

    // Try curated apps search first
    const cachedResults = await searchCachedPackages(
      query,
      sanitizedLimit,
      category
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
          chocolateyDownloads: p.chocolatey_downloads,
        })),
        source: 'curated',
      });
    }

    // Fall back to lib/winget-api if no curated results
    const packages = await searchPackages(query, sanitizedLimit, category || undefined);

    return NextResponse.json({
      query,
      count: packages.length,
      packages,
      source: 'api',
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search packages' },
      { status: 500 }
    );
  }
}
