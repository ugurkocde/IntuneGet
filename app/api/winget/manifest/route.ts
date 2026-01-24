import { NextRequest, NextResponse } from 'next/server';
import { getManifest, getInstallers, getBestInstaller } from '@/lib/winget-api';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const packageId = searchParams.get('id');
    const version = searchParams.get('version');
    const architecture = searchParams.get('arch') as 'x64' | 'x86' | 'arm64' | null;

    if (!packageId) {
      return NextResponse.json(
        { error: 'Package ID parameter "id" is required' },
        { status: 400 }
      );
    }

    const manifest = await getManifest(packageId, version || undefined);

    if (!manifest) {
      return NextResponse.json(
        { error: 'Manifest not found' },
        { status: 404 }
      );
    }

    // Get normalized installers
    const installers = await getInstallers(packageId, version || undefined);

    // Get best installer for requested architecture
    const bestInstaller = architecture
      ? await getBestInstaller(packageId, version || undefined, architecture)
      : installers[0] || null;

    return NextResponse.json({
      manifest: {
        id: manifest.Id,
        name: manifest.Name,
        publisher: manifest.Publisher,
        version: manifest.Version,
        description: manifest.Description || manifest.ShortDescription,
        homepage: manifest.Homepage,
        license: manifest.License,
        licenseUrl: manifest.LicenseUrl,
        tags: manifest.Tags,
      },
      installers,
      recommendedInstaller: bestInstaller,
    });
  } catch (error) {
    console.error('Manifest fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch manifest' },
      { status: 500 }
    );
  }
}
