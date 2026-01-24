import { NextRequest, NextResponse } from 'next/server';
import { getPackage, getPackageVersions, getInstallers } from '@/lib/winget-api';

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
      return NextResponse.json(
        { error: 'Package not found' },
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
  } catch (error) {
    console.error('Package fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch package details' },
      { status: 500 }
    );
  }
}
