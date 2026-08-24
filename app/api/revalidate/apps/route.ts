import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { verifyCallbackSignature } from '@/lib/callback-signature';

/**
 * On-demand ISR revalidation for public app detail pages.
 *
 * Called by the QA pipeline (IntuneGet-Workflows) right after a QA result is
 * reconciled into the catalog, so /apps/[wingetId] reflects a fresh QA run
 * within seconds instead of waiting out the daily ISR window. Authenticated
 * with the same HMAC-SHA256 X-Signature contract as the packaging callback.
 */

const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const MAX_IDS_PER_REQUEST = 50;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('X-Signature');
  const callbackSecret = process.env.CALLBACK_SECRET;

  if (!callbackSecret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[Revalidate] CALLBACK_SECRET is required in production');
      return NextResponse.json({ error: 'Revalidation is unavailable' }, { status: 503 });
    }
  } else if (!verifyCallbackSignature(body, signature, callbackSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const wingetIds =
    typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { wingetIds?: unknown }).wingetIds)
      ? ((parsed as { wingetIds: unknown[] }).wingetIds)
      : null;
  if (!wingetIds || wingetIds.length === 0) {
    return NextResponse.json({ error: 'wingetIds must be a non-empty array' }, { status: 400 });
  }
  if (wingetIds.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json(
      { error: `wingetIds is limited to ${MAX_IDS_PER_REQUEST} entries per request` },
      { status: 400 }
    );
  }

  const revalidated: string[] = [];
  const skipped: string[] = [];
  for (const id of wingetIds) {
    if (typeof id !== 'string' || !APP_ID_PATTERN.test(id)) {
      skipped.push(String(id));
      continue;
    }
    revalidatePath(`/apps/${encodeURIComponent(id)}`);
    revalidated.push(id);
  }

  return NextResponse.json({ revalidated, skipped });
}
