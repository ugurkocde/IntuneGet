import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { validateCandidate, CuratedCatalogError } from '@/lib/curated-catalog/core.mjs';
import { buildCuratedCartItem, curatedWorkflowInput } from '@/lib/curated-catalog/package';
import { normalizeQaWorkflowPackageInput, QA_PSADT_TOOLCHAIN } from '@/lib/qa/package-profile';
import type { CuratedCandidate, CuratedRelease } from '@/lib/curated-catalog/types';

export async function POST(request: NextRequest) {
  const expected = process.env.CURATED_CATALOG_OPERATOR_TOKEN;
  const provided = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!expected || !timingSafeEqual(digest(expected), digest(provided))) {
    return NextResponse.json({ error: 'Operator authentication required' }, { status: 401 });
  }
  try {
    if (Number(request.headers.get('content-length')) > 16_384) {
      return NextResponse.json({ error: 'Candidate metadata is too large' }, { status: 413 });
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 16_384) return NextResponse.json({ error: 'Candidate metadata is too large' }, { status: 413 });
    const { candidate, installerSha256 } = JSON.parse(text) as { candidate: CuratedCandidate; installerSha256: string };
    const app = CURATED_APPS.find(app => app.id === candidate?.appId);
    if (!app) throw new CuratedCatalogError('Unknown curated app.');
    validateCandidate(app, candidate);
    if (!/^[a-f0-9]{64}$/i.test(installerSha256) ||
        (candidate.vendorSha256 && candidate.vendorSha256.toLowerCase() !== installerSha256.toLowerCase())) {
      throw new CuratedCatalogError('A matching verified installer SHA256 is required.');
    }
    // A profile is a test input, never an approval or deployable release.
    const draft = { id: `${app.id}:${candidate.id}`, candidate, installerSha256 } as CuratedRelease;
    const item = buildCuratedCartItem(app, draft);
    const input = curatedWorkflowInput(item);
    const normalized = normalizeQaWorkflowPackageInput(input);
    return NextResponse.json({
      candidateId: candidate.id,
      packageId: app.packageId,
      installerUrl: candidate.installerUrl,
      installerSha256,
      workflowInput: { ...input, psadtConfig: normalized.psadtConfigJson, detectionRules: normalized.detectionRulesJson, uninstallCommand: normalized.uninstallCommand },
      executionProfileSha256: normalized.identity.executionProfileSha256,
      packageProfileCanonicalJson: normalized.identity.canonicalJson,
      packagerCommit: QA_PSADT_TOOLCHAIN.packagerCommit,
      approvalRequired: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CuratedCatalogError ? error.message : 'Invalid candidate metadata' }, { status: 400 });
  }
}
