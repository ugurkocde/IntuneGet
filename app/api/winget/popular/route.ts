import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  app_source: string | null;
  store_package_id: string | null;
}

type SortBy = 'popular' | 'name' | 'newest';

interface PopularPackagesResult {
  data: CuratedAppResult[];
  total: number;
}

async function getCuratedPackages(
  limit: number,
  offset: number,
  category: string | null,
  sort: SortBy
): Promise<PopularPackagesResult | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const baseQuery = supabase
    .from('curated_apps')
    .select('*', { count: 'exact', head: true })
    .eq('is_verified', true)
    .eq('is_locale_variant', false);

  const countQuery = category ? baseQuery.eq('category', category) : baseQuery;
  const { count: totalCount, error: countError } = await countQuery;

  if (countError) {
    console.error('Failed to count curated packages', { error: countError, category });
    return null;
  }

  let dataQuery = supabase
    .from('curated_apps')
    .select('id, winget_id, name, publisher, latest_version, description, homepage, category, tags, icon_path, popularity_rank, app_source, store_package_id')
    .eq('is_verified', true)
    .eq('is_locale_variant', false);

  if (category) {
    dataQuery = dataQuery.eq('category', category);
  }

  switch (sort) {
    case 'name':
      dataQuery = dataQuery.order('name', { ascending: true });
      break;
    case 'newest':
      dataQuery = dataQuery.order('created_at', { ascending: false });
      break;
    case 'popular':
    default:
      dataQuery = dataQuery
        .order('popularity_rank', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true });
      break;
  }

  const { data, error } = await dataQuery.range(offset, offset + limit - 1);

  if (error) {
    console.error('Failed to query curated packages', { error, category, sort, limit, offset });
    return null;
  }

  return {
    data: (data || []) as CuratedAppResult[],
    total: totalCount || 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    ) {
      return NextResponse.json(
        {
          error:
            'App catalog requires a configured Supabase database. See docs/SELF_HOSTING.md - the catalog is not available in standalone SQLite mode.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedLimit = parseInt(searchParams.get('limit') || '20', 10);
    const requestedOffset = parseInt(searchParams.get('offset') || '0', 10);
    const categoryParam = searchParams.get('category');
    const category = categoryParam && categoryParam.trim().length > 0
      ? categoryParam.trim()
      : null;
    const sortParam = searchParams.get('sort') || 'popular';
    const sort: SortBy = sortParam === 'name' || sortParam === 'newest' ? sortParam : 'popular';
    const sanitizedLimit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, 50))
      : 20;
    const sanitizedOffset = Number.isFinite(requestedOffset)
      ? Math.max(requestedOffset, 0)
      : 0;

    const result = await getCuratedPackages(
      sanitizedLimit,
      sanitizedOffset,
      category,
      sort
    );

    if (!result) {
      return NextResponse.json(
        { error: 'Failed to fetch popular packages' },
        { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const packages = result.data.map((p) => ({
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
      appSource: p.app_source === 'store' ? 'store' : 'win32',
      packageIdentifier: p.store_package_id || undefined,
    }));

    return NextResponse.json({
      count: packages.length,
      total: result.total,
      limit: sanitizedLimit,
      offset: sanitizedOffset,
      hasMore: sanitizedOffset + packages.length < result.total,
      packages,
      source: 'curated',
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch popular packages' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }
}
