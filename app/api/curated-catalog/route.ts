import { NextResponse } from 'next/server';
import { getCuratedCatalog } from '@/lib/curated-catalog/server';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { payload, entries } = getCuratedCatalog();
    return NextResponse.json({
      generatedAt: payload.generatedAt, expiresAt: payload.expiresAt,
      entries: entries.map(({ app, status, release }) => ({
        app: { id: app.id, name: app.name, publisher: app.publisher, channel: app.channel, category: app.category, homepage: app.homepage, architecture: app.architecture, scope: app.scope, locale: app.locale, autoUpdate: app.autoUpdate,
          licenceAttestation: app.licenceAttestation ?? null },
        status,
        release: release ? {
          id: release.id, version: release.candidate.version, approvedAt: release.approvedAt,
          installerSha256: release.installerSha256,
          sourceUrl: release.candidate.installerUrl,
          testedAt: release.evidence.qa.testedAt, testReportUrl: release.evidence.qa.reportUrl,
          securityReportUrl: release.evidence.security.reportUrl,
          signatureStatus: release.evidence.signature.status,
        } : null,
        cartItem: release ? buildCuratedCartItem(app, release) : null,
      })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Curated catalog verification failed:', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ error: 'The curated catalog is temporarily unavailable. Please try again later.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
