import { isQaMaintenanceMode } from '@/lib/qa/maintenance';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import {
  applyRateLimit,
  applyStrictRateLimit,
  getIpKey,
  QA_LIVE_FRAME_RATE_LIMIT,
  QA_LIVE_INGEST_RATE_LIMIT,
} from '@/lib/rate-limit';
import { QA_LIVE_FRAME_MAX_AGE_MS } from '@/lib/qa/constants';
import { isQaLivePublicEnabled } from '@/lib/qa/public-access';

export const dynamic = 'force-dynamic';
const BUCKET = 'qa-live-frames';
const MAX_FRAME_BYTES = 204_800;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function noStoreHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}

function frameHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
}

function bearerSecret(request: Request): string | null {
  const value = request.headers.get('authorization');
  if (!value?.startsWith('Bearer ')) return null;
  const secret = value.slice('Bearer '.length);
  return secret.length >= 24 && secret.length <= 256 ? secret : null;
}

function candidateId(request: Request): string | null {
  const value = request.headers.get('x-qa-candidate-id');
  return value && UUID_PATTERN.test(value) ? value : null;
}

async function authorizeIngest(request: Request, capturedAt: string) {
  const secret = bearerSecret(request);
  const id = candidateId(request);
  if (!secret || !id) return { authorized: false as const, id: null };

  const supabase = createServerClient();
  const { data, error } = await supabase.rpc('authorize_qa_live_frame_ingest', {
    p_secret: secret,
    p_candidate_id: id,
    p_captured_at: capturedAt,
  });
  if (error) throw new Error(`Could not authorize QA live-frame ingest: ${error.message}`);
  return { authorized: data === true, id };
}

async function authorizeCleanup(request: Request) {
  const secret = bearerSecret(request);
  const id = candidateId(request);
  if (!secret || !id) return { authorized: false as const, id: null };

  const supabase = createServerClient();
  const { data, error } = await supabase.rpc('authorize_qa_live_frame_cleanup', {
    p_secret: secret,
    p_candidate_id: id,
  });
  if (error) throw new Error(`Could not authorize QA live-frame cleanup: ${error.message}`);
  return { authorized: data === true, id };
}

export async function GET(request: Request) {
  if (!isQaLivePublicEnabled(new URL(request.url).hostname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStoreHeaders() });
  }
  if (isQaMaintenanceMode()) {
    return new NextResponse(null, { status: 204, headers: noStoreHeaders() });
  }
  const rateLimitResponse = await applyRateLimit(`qa-frame:${getIpKey(request)}`, QA_LIVE_FRAME_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const requestedCandidate = new URL(request.url).searchParams.get('candidate');
    if (!requestedCandidate || !UUID_PATTERN.test(requestedCandidate)) {
      return NextResponse.json({ error: 'Invalid candidate' }, { status: 400, headers: noStoreHeaders() });
    }
    const requestedSequenceValue = new URL(request.url).searchParams.get('sequence');
    const requestedSequence = requestedSequenceValue === null ? NaN : Number(requestedSequenceValue);
    if (!Number.isSafeInteger(requestedSequence) || requestedSequence < 0) {
      return NextResponse.json({ error: 'Invalid sequence' }, { status: 400, headers: noStoreHeaders() });
    }
    const supabase = createServerClient();
    const { data: active, error: activeError } = await supabase
      .from('qa_candidates')
      .select('id')
      .eq('id', requestedCandidate)
      .eq('test_level', 'psadt-package')
      .in('status', ['dispatched', 'running'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeError) throw new Error(`Could not load active QA candidate: ${activeError.message}`);
    if (!active) return new NextResponse(null, { status: 404, headers: noStoreHeaders() });

    const { data: frame, error: frameError } = await supabase
      .from('qa_live_frames')
      .select('object_path, captured_at, updated_at, sequence')
      .eq('candidate_id', active.id)
      .maybeSingle();
    if (frameError) throw new Error(`Could not load QA frame metadata: ${frameError.message}`);
    // The requested sequence is a cache-buster, not a lock. At a two-second
    // capture cadence the producer can publish the next frame between the
    // live-status request and this image request. Serve that newer frame for
    // the same active candidate instead of flashing an avoidable 404.
    if (!frame || Date.now() - new Date(frame.updated_at).getTime() > QA_LIVE_FRAME_MAX_AGE_MS) {
      return new NextResponse(null, { status: 404, headers: noStoreHeaders() });
    }

    const { data: image, error: downloadError } = await supabase.storage.from(BUCKET).download(frame.object_path);
    if (downloadError?.message === 'Object not found' || (!downloadError && !image)) {
      // Cleanup and ring-slot replacement can win the race after metadata was
      // read. This is an expected stale-frame miss, not a platform failure.
      return new NextResponse(null, { status: 404, headers: noStoreHeaders() });
    }
    if (downloadError || !image) throw new Error(`Could not download QA live frame: ${downloadError?.message || 'missing object'}`);

    return new NextResponse(await image.arrayBuffer(), {
      headers: frameHeaders({
        'Content-Type': 'image/jpeg',
        'Content-Length': String(image.size),
        'X-QA-Frame-Sequence': String(frame.sequence),
      }),
    });
  } catch (error) {
    console.error('Failed to serve QA live frame:', error);
    return NextResponse.json(
      { error: 'Live QA frame is temporarily unavailable' },
      { status: 503, headers: noStoreHeaders() }
    );
  }
}

export async function POST(request: Request) {
  if (!isQaLivePublicEnabled(new URL(request.url).hostname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStoreHeaders() });
  }
  const rateLimitResponse = await applyStrictRateLimit(`qa-frame-ingest:${getIpKey(request)}`, QA_LIVE_INGEST_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const capturedAtHeader = request.headers.get('x-qa-captured-at');
    const capturedAtDate = capturedAtHeader ? new Date(capturedAtHeader) : null;
    const capturedAt = capturedAtDate && Number.isFinite(capturedAtDate.getTime())
      ? capturedAtDate.toISOString()
      : null;
    const sequenceHeader = request.headers.get('x-qa-frame-sequence');
    const widthHeader = request.headers.get('x-qa-frame-width');
    const heightHeader = request.headers.get('x-qa-frame-height');
    const slotHeader = request.headers.get('x-qa-frame-slot');
    const sequence = sequenceHeader === null ? NaN : Number(sequenceHeader);
    const width = widthHeader === null ? NaN : Number(widthHeader);
    const height = heightHeader === null ? NaN : Number(heightHeader);
    const slot = slotHeader === null ? NaN : Number(slotHeader);
    if (
      !sequenceHeader?.trim() || !widthHeader?.trim() || !heightHeader?.trim() || !slotHeader?.trim() ||
      !capturedAt ||
      !Number.isSafeInteger(sequence) || sequence < 0 ||
      !Number.isInteger(width) || width < 64 || width > 1920 ||
      !Number.isInteger(height) || height < 64 || height > 1200 ||
      !Number.isInteger(slot) || slot < 0 || slot > 2
    ) {
      return NextResponse.json({ error: 'Invalid frame metadata' }, { status: 400, headers: noStoreHeaders() });
    }

    const authorization = await authorizeIngest(request, capturedAt);
    if (!authorization.authorized || !authorization.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders() });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (
      bytes.length < 4 || bytes.length > MAX_FRAME_BYTES ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9
    ) {
      return NextResponse.json({ error: 'Invalid JPEG frame' }, { status: 400, headers: noStoreHeaders() });
    }

    const supabase = createServerClient();
    const objectPath = `${authorization.id}/slot-${slot}.jpg`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: 'image/jpeg',
      upsert: true,
      cacheControl: '0',
    });
    if (uploadError) throw new Error(`Could not store QA live frame: ${uploadError.message}`);

    const { data: published, error: metadataError } = await supabase.rpc('publish_qa_live_frame_metadata', {
      p_secret: bearerSecret(request) || '',
      p_candidate_id: authorization.id,
      p_object_path: objectPath,
      p_sequence: sequence,
      p_captured_at: capturedAt,
      p_width: width,
      p_height: height,
      p_byte_size: bytes.length,
    });
    if (metadataError || published !== true) {
      const { data: currentFrame } = await supabase
        .from('qa_live_frames')
        .select('object_path')
        .eq('candidate_id', authorization.id)
        .maybeSingle();
      if (currentFrame?.object_path !== objectPath) {
        await supabase.storage.from(BUCKET).remove([objectPath]);
      }
      if (metadataError) throw new Error(`Could not publish QA live frame metadata: ${metadataError.message}`);
      return NextResponse.json({ error: 'Stale frame sequence' }, { status: 409, headers: noStoreHeaders() });
    }

    return NextResponse.json({ accepted: true, sequence }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error('Failed to ingest QA live frame:', error);
    return NextResponse.json(
      { error: 'Live QA frame ingest failed' },
      { status: 503, headers: noStoreHeaders() }
    );
  }
}

export async function DELETE(request: Request) {
  if (!isQaLivePublicEnabled(new URL(request.url).hostname)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStoreHeaders() });
  }
  const rateLimitResponse = await applyStrictRateLimit(`qa-frame-cleanup:${getIpKey(request)}`, QA_LIVE_INGEST_RATE_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const authorization = await authorizeCleanup(request);
    if (!authorization.authorized || !authorization.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStoreHeaders() });
    }

    const supabase = createServerClient();
    const { data: objects, error: listError } = await supabase.storage.from(BUCKET).list(authorization.id, { limit: 10 });
    if (listError) throw new Error(`Could not list QA live frames: ${listError.message}`);
    const paths = (objects || []).map((object) => `${authorization.id}/${object.name}`);
    if (paths.length) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
      if (removeError) throw new Error(`Could not remove QA live frames: ${removeError.message}`);
    }
    const { error: metadataError } = await supabase.from('qa_live_frames').delete().eq('candidate_id', authorization.id);
    if (metadataError) throw new Error(`Could not clear QA live frame metadata: ${metadataError.message}`);

    return NextResponse.json({ cleared: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error('Failed to clear QA live frames:', error);
    return NextResponse.json(
      { error: 'Live QA frame cleanup failed' },
      { status: 503, headers: noStoreHeaders() }
    );
  }
}
