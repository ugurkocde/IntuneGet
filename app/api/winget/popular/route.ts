import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';

export const fetchCache = 'force-no-store';

type SortBy = 'popular' | 'name' | 'newest';

export async function GET(request: NextRequest) {
  try {
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

    const result = await getCatalogSource().getPopularApps({
      limit: sanitizedLimit,
      offset: sanitizedOffset,
      category,
      sort,
    });

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
