import { NextResponse } from 'next/server';
import { getCuratedQaHistory } from '@/lib/qa/curated-history';
import { applyRateLimit, getIpKey, QA_LIVE_RATE_LIMIT } from '@/lib/rate-limit';
import { isQaLivePublicEnabled } from '@/lib/qa/public-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isQaLivePublicEnabled(new URL(request.url).hostname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const rateLimitResponse = await applyRateLimit(`qa-curated:${getIpKey(request)}`, QA_LIVE_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;
  try {
    return NextResponse.json({ runs: await getCuratedQaHistory() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Failed to load curated QA history:', error instanceof Error ? error.message : 'unknown error');
    return NextResponse.json({ error: 'Curated QA history is temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
