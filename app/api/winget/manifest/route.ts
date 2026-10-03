import { NextRequest, NextResponse } from 'next/server';
import { getManifest } from '@/lib/winget-api';
import { fetchAvailableVersionsLive, getLiveInstallers, GitHubUnavailableError } from '@/lib/manifest-api';
import { resolveListedWingetVersion } from '@/lib/winget-version';

export const fetchCache = 'force-no-store';
const headers = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(request: NextRequest) {
  const packageId = request.nextUrl.searchParams.get('id')?.trim();
  const requestedVersion = request.nextUrl.searchParams.get('version')?.trim();
  const architecture = request.nextUrl.searchParams.get('arch') || 'x64';
  if (!packageId) {
    return NextResponse.json({ error: 'Package ID parameter "id" is required' }, { status: 400, headers });
  }

  try {
    // History remains useful for installed apps, but it must not advertise
    // removed releases as deployable or resurrect their cached installers.
    let versions: string[];
    try {
      versions = await fetchAvailableVersionsLive(packageId, { strict: true });
    } catch (error) {
      // An exact selection can still be verified through the manifest's raw
      // fallback. Discovering a replacement needs a successful live listing.
      if (!requestedVersion || !(error instanceof GitHubUnavailableError)) throw error;
      versions = [requestedVersion];
    }
    const version = requestedVersion
      ? resolveListedWingetVersion(requestedVersion, versions)
      : versions[0];
    if (!version) {
      return NextResponse.json({
        code: 'MANIFEST_UNAVAILABLE',
        message: requestedVersion
          ? `Version ${requestedVersion} is no longer available from WinGet. Review the current version to update your selection.`
          : 'This app currently has no available versions in WinGet.',
        retryable: false,
        versions,
      }, { status: 409, headers });
    }

    const [manifest, installers] = await Promise.all([
      getManifest(packageId, version),
      getLiveInstallers(packageId, version),
    ]);
    if (installers.length === 0) {
      return NextResponse.json({
        code: 'MANIFEST_UNAVAILABLE',
        message: `Version ${version} is no longer available from WinGet. Review the current version to update your selection.`,
        retryable: false,
      }, { status: 409, headers });
    }

    const architecturePriority: Record<string, string[]> = {
      x64: ['x64', 'neutral', 'x86'],
      x86: ['x86', 'neutral', 'x64'],
      arm64: ['arm64', 'arm', 'neutral', 'x64'],
    };
    const recommendedInstaller = (architecturePriority[architecture] || architecturePriority.x64)
      .map((arch) => installers.find((installer) => installer.architecture === arch))
      .find(Boolean) || installers[0];
    return NextResponse.json({
      manifest: {
        id: packageId,
        name: manifest?.Name || packageId,
        publisher: manifest?.Publisher || packageId.split('.')[0],
        version,
        description: manifest?.Description || manifest?.ShortDescription,
        homepage: manifest?.Homepage,
        license: manifest?.License,
        licenseUrl: manifest?.LicenseUrl,
        tags: manifest?.Tags,
      },
      installers,
      recommendedInstaller,
      versions,
    }, { headers });
  } catch (error) {
    console.warn('Manifest selection lookup failed', { packageId, version: requestedVersion, error });
    const upstream = error instanceof GitHubUnavailableError;
    return NextResponse.json({
      code: upstream ? 'UPSTREAM_UNAVAILABLE' : 'MANIFEST_LOOKUP_FAILED',
      message: 'We could not check available installers right now. Your selection has not changed. Please try again shortly.',
      retryable: true,
    }, { status: upstream ? 503 : 500, headers });
  }
}
