import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { getGitHubActionsConfig } from '@/lib/github-actions';
import { createCuratedVerificationProfile, CURATED_APPS } from '@/lib/curated-catalog/verification-profile';
import { compareReleaseVersions } from '@/lib/curated-catalog/core.mjs';
import { QA_PSADT_TOOLCHAIN } from './package-profile';

const WORKFLOW = 'curated-catalog-verification.yml';
const LOST_DISPATCH_MS = 3 * 60 * 60 * 1000;
type QueueRow = Database['public']['Tables']['curated_verification_queue']['Row'];
type Run = { id: number; display_title: string; status: string; created_at: string; event: string; head_branch: string; path: string };

export function curatedQueueInputs(row: QueueRow): Record<string, string> {
  const inputs = row.inputs as Record<string, string>;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) ||
    Object.entries(inputs).some(([key, value]) => !['candidate', 'previous', 'psadt_config', 'app_label'].includes(key) ||
      typeof value !== 'string' || value.length > 16384)) throw new Error('Invalid curated verification inputs.');
  const candidate = JSON.parse(inputs.candidate);
  const configId = /\[config:([0-9a-f-]{36})\]$/.exec(inputs.app_label)?.[1];
  const expectedKey = row.kind === 'config' && configId ? `config:${configId}` : `release:${candidate.id}`;
  if (candidate.appId !== row.app_id || candidate.version !== row.version || expectedKey !== row.verification_key ||
    (row.kind === 'release' && (!inputs.app_label.endsWith(`[${candidate.id}]`) || inputs.psadt_config)) ||
    (row.kind === 'config' && (!configId || !inputs.psadt_config))) throw new Error('Curated queue identity differs from its inputs.');
  const psadtConfig = inputs.psadt_config ? JSON.parse(inputs.psadt_config) : undefined;
  createCuratedVerificationProfile(candidate, candidate.vendorSha256 || '0'.repeat(64), psadtConfig);
  if (inputs.previous) {
    const previous = JSON.parse(inputs.previous);
    if (previous.appId !== candidate.appId || compareReleaseVersions(previous.version, candidate.version) >= 0) throw new Error('Invalid curated upgrade source.');
    createCuratedVerificationProfile(previous, previous.vendorSha256 || '0'.repeat(64), psadtConfig);
  } else if (CURATED_APPS.find(app => app.id === candidate.appId)?.autoUpdate !== 'vendor-managed') {
    throw new Error('An earlier curated installer is required for upgrade QA.');
  }
  return inputs;
}

/** Runs once per minute with the ordinary dispatcher; never builds a GitHub backlog. */
export async function dispatchCuratedQueue(supabase: SupabaseClient<Database>, now = new Date(), fetchImpl = fetch) {
  const config = getGitHubActionsConfig();
  const base = `https://api.github.com/repos/${config.owner}/${config.workflowsRepo}/actions`;
  const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' };
  const { data: active, error: activeError } = await supabase.from('curated_verification_queue').select('*').eq('status', 'dispatched').maybeSingle();
  if (activeError) throw new Error('Could not inspect active curated QA.');
  if (active) {
    const response = await fetchImpl(`${base}/workflows/${WORKFLOW}/runs?per_page=100`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Could not reconcile curated QA (${response.status}).`);
    const payload = await response.json();
    if (!Array.isArray(payload.workflow_runs) || !Number.isInteger(payload.total_count) || payload.total_count < 0 ||
      payload.workflow_runs.some((run: Run) => !Number.isSafeInteger(run.id) || run.id <= 0 ||
        !Number.isFinite(Date.parse(run.created_at)) ||
        [run.display_title, run.status, run.event, run.head_branch, run.path].some(value => typeof value !== 'string'))) {
      throw new Error('Invalid curated workflow inventory.');
    }
    const dispatchedAt = Date.parse(active.dispatched_at || '');
    if (!Number.isFinite(dispatchedAt)) throw new Error('Invalid curated dispatch timestamp.');
    const run = (payload.workflow_runs as Run[]).find(run => run.display_title === `Curated verification - ${(active.inputs as Record<string, string>).app_label}` &&
      Date.parse(run.created_at) >= dispatchedAt - 5000 && run.event === 'workflow_dispatch' &&
      run.head_branch === config.ref && run.path.split('@')[0] === `.github/workflows/${WORKFLOW}`);
    if (run && (!Number.isSafeInteger(run.id) || run.id <= 0)) throw new Error('Invalid curated workflow run identity.');
    if (run && run.status !== 'completed') return { handled: true, dispatched: false, reason: 'qa_active' };
    if (!run) {
      if (now.getTime() - dispatchedAt < LOST_DISPATCH_MS) return { handled: true, dispatched: false, reason: 'qa_active' };
      // Never retry an ambiguous dispatch unless this inventory covers its full time window.
      const oldest = Math.min(...payload.workflow_runs.map((item: Run) => Date.parse(item.created_at)));
      if (payload.total_count > payload.workflow_runs.length && oldest > dispatchedAt - 5000) throw new Error('Curated dispatch inventory is incomplete.');
    }
    const { error } = await supabase.from('curated_verification_queue').update({ status: run ? 'completed' : 'queued',
      github_run_id: run ? String(run.id) : null, finished_at: run ? now.toISOString() : null,
      dispatched_at: run ? active.dispatched_at : null, updated_at: now.toISOString() }).eq('id', active.id).eq('status', 'dispatched');
    if (error) throw new Error('Could not reconcile the curated QA claim.');
  }
  const { data: next, error: queueError } = await supabase.from('curated_verification_queue').select('*').eq('status', 'queued')
    .order('priority', { ascending: false }).order('enqueued_at', { ascending: true }).order('id', { ascending: true }).limit(1).maybeSingle();
  if (queueError) throw new Error('Could not inspect queued curated QA.');
  if (!next) return { handled: false, dispatched: false };
  let inputs: Record<string, string>;
  try { inputs = curatedQueueInputs(next); } catch {
    const { error } = await supabase.from('curated_verification_queue').update({ status: 'superseded', finished_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', next.id).eq('status', 'queued');
    if (error) throw new Error('Could not retire invalid curated QA inputs.');
    return { handled: false, dispatched: false };
  }
  const { data, error: claimError } = await supabase.rpc('claim_qa_work', { p_kind: 'curated', p_id: next.id, p_packager_commit: QA_PSADT_TOOLCHAIN.packagerCommit });
  if (claimError) throw new Error('Could not claim curated QA.');
  const claim = data as { row?: QueueRow; reason?: string; queue?: string } | null;
  if (!claim?.row) return { handled: claim?.reason !== 'higher_priority_work' || claim.queue !== 'ordinary', dispatched: false, reason: claim?.reason || 'claim_lost' };
  // Keep the claim on network/dispatch errors: a timeout may hide an accepted
  // workflow. Inventory reconciliation resolves it before anything else starts.
  const response = await fetchImpl(`${base}/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST', headers, body: JSON.stringify({ ref: config.ref, inputs }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Curated QA dispatch failed (${response.status}).`);
  if (next.kind === 'config') {
    const id = next.verification_key.slice('config:'.length);
    const { error } = await supabase.from('curated_config_verifications').update({ status: 'verifying', updated_at: now.toISOString() }).eq('id', id).eq('status', 'requested');
    if (error) console.warn('Curated settings status update will be reconciled on the next poll.');
  }
  return { handled: true, dispatched: true, candidateId: next.id, queue: 'curated' };
}
