import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/database';
import type { Win32CartItem } from '@/types/upload';
import { qaSourceKey } from '@/lib/qa/source-backoff';
import { loadInstallerSecurityHolds } from '@/lib/qa/installer-security-holds';
import { createInstallerHealthKey } from '@/lib/installer-preflight';
import { reconcileCatalogInstaller } from '@/lib/catalog-installer-reconciliation';
import { customerUpstreamStatus, type CustomerUpstreamReason } from './customer-upstream-status';

type Job = Database['public']['Tables']['packaging_jobs']['Row'];
const sha = /^[a-f0-9]{40}$/i;
const hash = /^[a-f0-9]{64}$/i;
const minute = 60_000;
const same = (a: string | null, b: string | null) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const details = (job: Job) => job.error_details && typeof job.error_details === 'object' && !Array.isArray(job.error_details) ? job.error_details : {};
const fingerprint = (item: Win32CartItem) => createHash('sha256').update(JSON.stringify([
  item.version, item.architecture, item.installerUrl, item.installerSha256?.toUpperCase(), item.installerType,
  item.installScope, item.installCommand, item.uninstallCommand,
])).digest('hex');

async function feedHead(client: SupabaseClient<Database>) {
  // QA owns and advances this cursor through winget-changes.ts. Never poll a
  // second feed or change its cursor from customer recovery.
  const result = await client.from('qa_winget_poll_state').select('head_sha')
    .eq('id', 'microsoft/winget-pkgs').maybeSingle();
  if (result.error) throw new Error('Manifest change state is unavailable');
  return result.data?.head_sha && sha.test(result.data.head_sha) ? result.data.head_sha : null;
}

/** Only writes the observed customer job. Candidate, source and security rows
 * remain read only; a read failure must keep the caller waiting. */
export async function holdCustomerUpstreamJob(client: SupabaseClient<Database>, job: Job): Promise<boolean> {
  const item = job.package_config as unknown as Win32CartItem | null;
  if (job.status !== 'awaiting_qa' || !job.qa_candidate_id || job.github_run_id || job.intune_app_id ||
      job.cancelled_at || job.archived_at || !item || item.sourceType === 'custom' || item.sourceType === 'curated' ||
      !job.installer_sha256 || !hash.test(job.installer_sha256) || !job.installer_url) return false;
  if (item.wingetId !== job.winget_id || item.version !== job.version ||
      !same(item.architecture || 'x64', job.architecture) || item.installerUrl !== job.installer_url ||
      !same(item.installerSha256, job.installer_sha256)) return false;
  const { data: candidate, error } = await client.from('qa_candidates')
    .select('id,winget_id,version,architecture,installer_url,installer_sha256,status,phase')
    .eq('id', job.qa_candidate_id).maybeSingle();
  if (error) throw new Error('Upstream validation evidence is unavailable');
  if (!candidate || !same(candidate.winget_id, job.winget_id) || candidate.version !== job.version ||
      !same(candidate.architecture, job.architecture) || candidate.installer_url !== job.installer_url ||
      !same(candidate.installer_sha256, job.installer_sha256) || candidate.phase === 'publishing' ||
      !['queued', 'error'].includes(candidate.status)) return false;
  const [backoff, health, holds, security] = await Promise.all([
    client.from('qa_source_backoff').select('failure_count,next_retry_at').eq('source_key', qaSourceKey(candidate)).maybeSingle(),
    client.from('installer_health').select('status,reason_code,expires_at')
      .eq('cache_key', createInstallerHealthKey({ wingetId: job.winget_id, version: job.version,
        architecture: job.architecture || 'x64', installerUrl: job.installer_url,
        installerSha256: job.installer_sha256, installerType: item.installerType, installScope: item.installScope })).maybeSingle(),
    loadInstallerSecurityHolds(client, [job.installer_sha256]),
    client.from('qa_package_results').select('installer_sha256').eq('winget_id', candidate.winget_id)
      .eq('tested_version', job.version).eq('architecture', candidate.architecture)
      .ilike('installer_sha256', job.installer_sha256)
      .or('virustotal_malicious.gt.0,virustotal_suspicious.gt.0').limit(1),
  ]);
  if (backoff.error || health.error || security.error) throw new Error('Upstream validation evidence is unavailable');
  if (holds.size || security.data?.length || health.data?.status === 'quarantined') return false;
  const now = Date.now();
  let reason: CustomerUpstreamReason | null = null;
  let retryAt = now + 24 * 60 * minute;
  if (health.data?.status === 'error' && health.data.reason_code === 'MANIFEST_CHANGED' &&
      Date.parse(health.data.expires_at || '') > now) {
    reason = 'UPSTREAM_METADATA_MISMATCH'; retryAt = Date.parse(health.data.expires_at!);
  } else if (backoff.data && backoff.data.failure_count >= 7 && Date.parse(backoff.data.next_retry_at) > now) {
    reason = 'UPSTREAM_SOURCE_BACKOFF'; retryAt = Date.parse(backoff.data.next_retry_at);
  }
  if (!reason) return false;
  const head = await feedHead(client);
  const result = await client.from('packaging_jobs').update({
    status: 'blocked_upstream', error_code: reason, status_message: customerUpstreamStatus(reason).message,
    error_message: null, error_stage: 'validation', error_category: 'installer',
    error_details: { upstreamManifestSha: head, upstreamFingerprint: fingerprint(item), upstreamRetryAt: new Date(retryAt).toISOString() },
    qa_resume_due_at: new Date(now + minute).toISOString(),
  }).eq('id', job.id).eq('status', 'awaiting_qa').eq('updated_at', job.updated_at)
    .eq('qa_candidate_id', job.qa_candidate_id).eq('installer_sha256', job.installer_sha256)
    .eq('installer_url', job.installer_url).eq('version', job.version)
    .is('archived_at', null).is('cancelled_at', null).is('github_run_id', null).is('intune_app_id', null)
    .select('id').maybeSingle();
  if (result.error) throw new Error('Could not preserve the upstream job block');
  // A lost CAS means a newer owner won. Do not dispatch from this stale read.
  return true;
}

/** Re-evaluate the selected version after QA's existing manifest feed moves.
 * This returns jobs to normal validation only, never directly to packaging. */
export async function reopenCustomerUpstreamJobs(client: SupabaseClient<Database>, deadline = Date.now() + 10_000): Promise<number> {
  const now = Date.now();
  const { data: jobs, error } = await client.from('packaging_jobs').select('*')
    .eq('status', 'blocked_upstream').lte('qa_resume_due_at', new Date(now).toISOString())
    .is('archived_at', null).is('cancelled_at', null).is('intune_app_id', null).is('github_run_id', null)
    .order('qa_resume_due_at', { ascending: true }).order('id', { ascending: true }).limit(10);
  if (error) throw new Error('Could not read upstream blocked jobs');
  if (!jobs?.length) return 0;
  const head = await feedHead(client);
  let reopened = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    const write = async (patch: Database['public']['Tables']['packaging_jobs']['Update']) => {
      let query = client.from('packaging_jobs').update(patch).eq('id', job.id)
        .eq('status', 'blocked_upstream').eq('updated_at', job.updated_at).eq('version', job.version)
        .is('archived_at', null).is('cancelled_at', null).is('github_run_id', null).is('intune_app_id', null);
      query = job.error_code == null ? query.is('error_code', null) : query.eq('error_code', job.error_code);
      const result = await query.select('id').maybeSingle();
      if (result.error) throw new Error('Could not recheck the upstream job block');
      return result.data;
    };
    const defer = () => write({ qa_resume_due_at: new Date(Date.now() + 15 * minute).toISOString() });
    if (!['UPSTREAM_SOURCE_BACKOFF', 'UPSTREAM_METADATA_MISMATCH'].includes(job.error_code || '')) { await defer(); continue; }
    const previous = details(job);
    const item = job.package_config as unknown as Win32CartItem | null;
    if (!item || item.version !== job.version || item.wingetId !== job.winget_id) { await defer(); continue; }
    const fallbackDue = Date.parse(String(previous.upstreamRetryAt || '')) <= now;
    let wake = false;
    let retryAt = new Date(now + 5 * minute).toISOString();
    if ((head && head !== previous.upstreamManifestSha) || fallbackDue) {
      try {
        const reconciled = await reconcileCatalogInstaller(item);
        // Even a malformed provider response cannot switch a customer's version.
        if (reconciled.item.version !== job.version || reconciled.item.wingetId !== job.winget_id) throw new Error('Selected version changed');
        wake = fallbackDue || fingerprint(reconciled.item) !== previous.upstreamFingerprint;
      } catch {
        // Retain the old cursor so a transient manifest failure is retried.
        await defer();
        continue;
      }
    }
    if (wake) retryAt = new Date(now).toISOString();
    const patch: Database['public']['Tables']['packaging_jobs']['Update'] = wake ? {
      status: 'awaiting_qa', status_message: 'Waiting for installation validation. Next event: an available validation slot.',
      qa_candidate_id: null, error_code: null, error_message: null, error_stage: null, error_category: null,
      error_details: null, qa_resume_due_at: retryAt,
    } : { error_details: { ...previous, upstreamManifestSha: head } as Json, qa_resume_due_at: retryAt };
    if (await write(patch) && wake) reopened++;
  }
  return reopened;
}
