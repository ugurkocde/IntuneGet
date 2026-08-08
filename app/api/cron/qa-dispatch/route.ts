import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { dispatchQaCandidate } from '@/lib/qa/dispatch';
import { qaTimeoutRecoveryUpdate } from '@/lib/qa/recovery';

const DISPATCH_TIMEOUT_MS = 15 * 60 * 1000;
const RUN_TIMEOUT_MS = 5 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 2;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const now = new Date();
  const { data: active, error: activeError } = await supabase
    .from('qa_candidates')
    .select('*')
    .eq('test_level', 'psadt-package')
    .in('status', ['dispatched', 'running']);
  if (activeError) throw new Error(`Could not reconcile QA candidates: ${activeError.message}`);

  let reconciled = 0;
  for (const candidate of active || []) {
    const timestamp = candidate.status === 'running' ? candidate.started_at : candidate.dispatched_at;
    const timeout = candidate.status === 'running' ? RUN_TIMEOUT_MS : DISPATCH_TIMEOUT_MS;
    if (timestamp && now.getTime() - new Date(timestamp).getTime() <= timeout) continue;

    const recovery = qaTimeoutRecoveryUpdate(candidate, now.toISOString(), MAX_ATTEMPTS);
    const { error } = await supabase
      .from('qa_candidates')
      .update(recovery)
      .eq('id', candidate.id)
      .eq('status', candidate.status);
    if (error) throw error;
    reconciled++;
  }

  const { data: stillActive, error: stillActiveError } = await supabase
    .from('qa_candidates')
    .select('id')
    .eq('test_level', 'psadt-package')
    .in('status', ['dispatched', 'running'])
    .limit(1);
  if (stillActiveError) throw stillActiveError;
  if (stillActive?.length) {
    return NextResponse.json({ success: true, dispatched: false, reason: 'qa_active', reconciled });
  }

  const { data: next, error: queueError } = await supabase
    .from('qa_candidates')
    .select('*')
    .eq('test_level', 'psadt-package')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('enqueued_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (queueError) throw queueError;
  if (!next) {
    return NextResponse.json({ success: true, dispatched: false, reason: 'queue_empty', reconciled });
  }

  const dispatchedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('qa_candidates')
    .update({
      status: 'dispatched',
      attempts: next.attempts + 1,
      dispatched_at: dispatchedAt,
      failure_summary: null,
      updated_at: dispatchedAt,
    })
    .eq('id', next.id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();
  if (claimError?.code === '23505') {
    return NextResponse.json({ success: true, dispatched: false, reason: 'claim_lost', reconciled });
  }
  if (claimError) throw claimError;
  if (!claimed) {
    return NextResponse.json({ success: true, dispatched: false, reason: 'claim_lost', reconciled });
  }

  try {
    await dispatchQaCandidate(claimed);
    return NextResponse.json({ success: true, dispatched: true, candidateId: claimed.id, reconciled });
  } catch (error) {
    console.error(`QA dispatch failed for candidate ${claimed.id}:`, error);
    await supabase
      .from('qa_candidates')
      .update({
        status: 'queued',
        attempts: next.attempts,
        dispatched_at: null,
        failure_summary: 'QA workflow dispatch failed; retry scheduled.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', claimed.id)
      .eq('status', 'dispatched');
    throw error;
  }
}

/** Operator recovery for a terminal infrastructure error; protected by CRON_SECRET. */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { candidateId?: string } | null;
  if (!body?.candidateId || !/^[0-9a-fA-F-]{36}$/.test(body.candidateId)) {
    return NextResponse.json({ error: 'A candidate UUID is required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('qa_candidates')
    .update({
      status: 'queued',
      attempts: 0,
      dispatched_at: null,
      started_at: null,
      finished_at: null,
      github_run_id: null,
      github_run_url: null,
      failure_summary: null,
      updated_at: now,
    })
    .eq('id', body.candidateId)
    .eq('test_level', 'psadt-package')
    .in('status', ['error', 'superseded'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return NextResponse.json({ error: 'Candidate is not retryable' }, { status: 409 });
  }
  return NextResponse.json({ success: true, candidateId: data.id });
}

export const maxDuration = 60;
