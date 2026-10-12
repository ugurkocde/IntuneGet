import { NextRequest, NextResponse } from 'next/server';
import { getCatalogSource } from '@/lib/catalog';
import { toQaCandidateStatus, toQaStatus } from '@/lib/qa/status';
import { applyRateLimit, getIpKey, PUBLIC_RATE_LIMIT } from '@/lib/rate-limit';
import type { QaStatus } from '@/types/qa';

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=120';

export async function GET(request: NextRequest) {
  const rateLimitResponse = await applyRateLimit(getIpKey(request), PUBLIC_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const rawIds = request.nextUrl.searchParams.get('ids') || '';
  const ids = [...new Set(rawIds.split(',').map((id) => id.trim()).filter(Boolean))];

  if (ids.length === 0 || ids.length > 100) {
    return NextResponse.json(
      { error: 'Provide between 1 and 100 comma-separated package IDs' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  try {
    // Store product IDs share the catalog but are not WinGet IDs. Treat any
    // unsupported identifier as untested instead of failing the entire batch.
    const validIds = ids.filter((id) => APP_ID_PATTERN.test(id));
    const catalog = getCatalogSource();
    const [rows, candidates] = validIds.length > 0
      ? await Promise.all([
          catalog.getQaStatuses(validIds),
          catalog.getQaCandidateStatuses(validIds),
        ])
      : [[], []];
    const statuses: Record<string, QaStatus | null> = Object.fromEntries(
      ids.map((id) => [id, null])
    );
    for (const row of rows) statuses[row.winget_id] = toQaStatus(row);
    for (const candidate of candidates) {
      statuses[candidate.winget_id] = toQaCandidateStatus(candidate);
    }

    return NextResponse.json({ statuses }, { headers: { 'Cache-Control': CACHE_CONTROL } });
  } catch (error) {
    console.error('Failed to load QA statuses:', error);
    return NextResponse.json(
      { error: 'Failed to load QA statuses' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
