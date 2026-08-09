import { NextResponse } from 'next/server';
import { getQaLiveSnapshot } from '@/lib/qa/live';
import { applyRateLimit, getIpKey, QA_LIVE_RATE_LIMIT } from '@/lib/rate-limit';
import { isQaLivePublicEnabled } from '@/lib/qa/public-access';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!isQaLivePublicEnabled(new URL(request.url).hostname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  const rateLimitResponse = await applyRateLimit(`qa-live:${getIpKey(request)}`, QA_LIVE_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const response = await getQaLiveSnapshot();
    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Failed to load live QA dashboard:', error);
    return NextResponse.json(
      { error: 'Live QA status is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
