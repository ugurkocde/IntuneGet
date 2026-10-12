import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { CuratedCatalogError } from '@/lib/curated-catalog/core.mjs';
import { createCuratedVerificationProfile } from '@/lib/curated-catalog/verification-profile';
import type { CuratedCandidate } from '@/lib/curated-catalog/types';

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
    return NextResponse.json(createCuratedVerificationProfile(candidate, installerSha256), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CuratedCatalogError ? error.message : 'Invalid candidate metadata' }, { status: 400 });
  }
}
