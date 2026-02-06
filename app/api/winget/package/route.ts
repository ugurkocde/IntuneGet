import { NextRequest, NextResponse } from 'next/server';
import { getPackage, getPackageVersions, getInstallers } from '@/lib/winget-api';
import { fetchSimilarPackages } from '@/lib/manifest-api';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const packageId = searchParams.get('id');
    const version = searchParams.get('version');
    const includeInstallers = searchParams.get('installers') === 'true';

    if (!packageId) {
      return NextResponse.json(
        { error: 'Package ID parameter "id" is required' },
        { status: 400 }
      );
    }

    const pkg = await getPackage(packageId);

    if (!pkg) {
      // Fetch similar packages to suggest
      const suggestions = await fetchSimilarPackages(packageId);
      return NextResponse.json(
        {
          error: 'Package not found',
          message: suggestions.length > 0
            ? `Package "${packageId}" not found. Did you mean one of these?`
            : `Package "${packageId}" not found in winget-pkgs repository`,
          suggestions,
        },
        { status: 404 }
      );
    }

    // Get versions
    const versions = await getPackageVersions(packageId);

    // Optionally include installers
    let installers = null;
    if (includeInstallers) {
      installers = await getInstallers(packageId, version || pkg.version);
    }

    return NextResponse.json({
      package: pkg,
      versions,
      installers,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch package details' },
      { status: 500 }
    );
  }
}
