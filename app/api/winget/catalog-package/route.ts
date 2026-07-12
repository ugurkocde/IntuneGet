import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';
import type { NormalizedPackage } from '@/types/winget';

export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  const packageId = request.nextUrl.searchParams.get('id')?.trim();

  if (!packageId) {
    return NextResponse.json(
      { error: 'Package ID parameter "id" is required' },
      { status: 400, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  try {
    const details = await getCatalogSource().getAppByWingetId(packageId);
    const app = details?.app;

    if (
      !app ||
      app.winget_id !== packageId ||
      app.is_verified !== true ||
      app.is_locale_variant === true
    ) {
      return NextResponse.json(
        { error: 'Package not found in the supported catalog' },
        { status: 404, headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    }

    const pkg: NormalizedPackage = {
      id: app.winget_id,
      name: app.name,
      publisher: app.publisher,
      version: app.latest_version || details.versions[0] || '',
      description: app.description,
      homepage: app.homepage,
      license: app.license,
      tags: app.tags || [],
      versions: details.versions.length > 0 ? details.versions : undefined,
      iconPath: app.icon_path,
      category: app.category,
      popularityRank: app.popularity_rank,
      appSource: app.app_source === 'store' ? 'store' : 'win32',
      packageIdentifier: app.store_package_id || undefined,
      localeVariants: details.localeVariants,
      isLocaleVariant: false,
    };

    return NextResponse.json(
      { package: pkg },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Failed to load the supported catalog package' },
      { status: 500, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
}
