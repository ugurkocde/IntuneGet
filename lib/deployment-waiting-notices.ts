import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { CUSTOMER_WAIT_MS, customerWaitSince, type WaitingCustomerJob } from './customer-wait-options';

interface WaitingJob extends WaitingCustomerJob {
  id: string;
  user_email: string | null;
  display_name: string | null;
  winget_id: string;
}

function noticeId(jobId: string): string {
  const bytes = createHash('sha256').update(`deployment_waiting:${jobId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Insert once per request. Read state and deployment state are never changed. */
export async function sendDeploymentWaitingNotices(supabase: SupabaseClient, now: number) {
  const result = { scanned: 0, eligible: 0, inserted: 0, skippedNoOwner: 0, skippedNoEmail: 0,
    truncated: false, errors: [] as string[], error: undefined as string | undefined };
  if (!Number.isFinite(now)) return { ...result, error: 'Invalid notice scan time', errors: ['Invalid notice scan time'] };
  const cutoff = new Date(now - CUSTOMER_WAIT_MS).toISOString();
  const signal = AbortSignal.timeout(10_000);
  for (const column of ['created_at', 'qa_requested_at'] as const) {
    try {
      let cursor: { time: string; id: string } | null = null;
      for (let page = 0; page < 2; page++) {
        let query = supabase.from('packaging_jobs')
          .select('id,user_id,user_email,display_name,winget_id,status,created_at,qa_requested_at')
          .in('status', ['awaiting_qa', 'blocked_upstream']).is('archived_at', null)
          .lte(column, cutoff).order(column, { ascending: false }).order('id', { ascending: false }).limit(500);
        query = column === 'created_at' ? query.is('qa_requested_at', null) : query.not('qa_requested_at', 'is', null);
        if (cursor) query = query.or(`${column}.lt."${cursor.time}",and(${column}.eq."${cursor.time}",id.lt.${cursor.id})`);
        const { data, error } = await query.abortSignal(signal);
        if (error) { result.errors.push('Waiting job scan failed'); break; }
        const jobs = (data || []) as WaitingJob[];
        result.scanned += jobs.length;
        const rows = [];
        for (const job of jobs) {
          const wait = customerWaitSince(job, now);
          if (!wait) continue;
          result.eligible++;
          if (!job.user_id?.trim()) { result.skippedNoOwner++; continue; }
          if (!job.user_email?.trim()) { result.skippedNoEmail++; continue; }
          rows.push({ id: noticeId(job.id), user_id: job.user_id, user_email: job.user_email,
            type: 'deployment_waiting', title: `Still waiting: ${(job.display_name || job.winget_id).slice(0, 150)}`.slice(0, 200),
            message: 'This request has waited at least 72 hours. Open Uploads to review your options.',
            data: { job_id: job.id, winget_id: job.winget_id, from_creation: wait.fromCreation, started_at: wait.startedAt } });
        }
        if (rows.length) {
          const inserted = await supabase.from('user_notifications')
            .upsert(rows, { onConflict: 'id', ignoreDuplicates: true }).select('id').abortSignal(signal);
          if (inserted.error) { result.errors.push('Waiting notification insert failed'); break; }
          result.inserted += inserted.data?.length || 0;
        }
        if (jobs.length < 500) break;
        if (page === 1) {
          result.truncated = true;
          console.error('[DeploymentWaiting] Waiting notification scan reached its branch limit');
          break;
        }
        const last = jobs[jobs.length - 1];
        const time = column === 'created_at' ? last.created_at : last.qa_requested_at;
        if (!customerWaitSince(last, now) || !time || !/^[0-9a-f-]{36}$/i.test(last.id)) {
          result.errors.push('Invalid waiting notification cursor'); break;
        }
        cursor = { time, id: last.id };
      }
    } catch {
      result.errors.push('Waiting notification scan unavailable');
    }
  }
  if (result.errors.length) {
    result.error = result.errors[0];
    console.error('[DeploymentWaiting]', result.error);
  }
  return result;
}
