import { createHash } from 'node:crypto';

export const PUBLICATION_FAILURE = 'QA result publication did not complete; inspect the protected workflow run.';
export function recoveryKind(candidate) {
  if (candidate.status !== 'error' || candidate.test_level !== 'psadt-package') return null;
  if (candidate.failure_summary === PUBLICATION_FAILURE) return 'publication';
  if (/^The QA workflow completed without reporting a terminal candidate result\.$/.test(candidate.failure_summary || '')) return 'lifecycle';
  if (/^The installer source remained unavailable after \d+ verification attempts\. The app was not tested\.$/.test(candidate.failure_summary || '')) return 'source';
  return null;
}

export function retryDelayMs(attempt) {
  return [5, 15, 60, 360, 1440][Math.min(Math.max(attempt - 1, 0), 4)] * 60_000;
}

export function rateLimitUntil(response, now = Date.now()) {
  if (![403, 429].includes(response.status)) return null;
  const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
  const retry = Number(response.headers.get('retry-after')) * 1000;
  if (response.status !== 429 && response.headers.get('x-ratelimit-remaining') !== '0' && !retry) return null;
  return new Date(Math.max(now + 60_000, Number.isFinite(reset) ? reset + 5000 : 0, now + retry)).toISOString();
}

/** No arbitrary workflow IDs or repository URLs from the candidate are followed. */
export async function publicationJob(runId, github) {
  if (!/^[1-9][0-9]*$/.test(runId || '')) throw new Error('Invalid QA workflow run ID');
  const run = await github(`/actions/runs/${runId}`);
  if (!run) throw new Error('Incomplete QA workflow evidence');
  if (String(run.id) !== runId || run.path !== '.github/workflows/intune-qa.yml' ||
      run.head_branch !== 'main' || run.event !== 'workflow_dispatch') throw new Error('QA workflow identity mismatch');
  if (run.status !== 'completed') return { waiting: true };
  const payload = await github(`/actions/runs/${runId}/jobs?filter=all&per_page=100`);
  if (!payload || !Array.isArray(payload.jobs) || payload.total_count > 100) throw new Error('Incomplete QA job evidence');
  const latest = name => payload.jobs.filter(j => j.name === name).sort((a, b) => a.id - b.id).at(-1);
  const qa = latest('qa');
  const publisher = latest('Publish compact app JSON');
  // A job-specific rerun preserves completed VM evidence, including failures.
  // Failed lifecycle evidence must reach the normal fail-close reporter too.
  if (['success', 'failure'].includes(qa?.conclusion) && publisher?.status === 'completed' &&
      ['failure', 'cancelled', 'timed_out'].includes(publisher.conclusion) && Number.isSafeInteger(publisher.id)) {
    return { jobId: publisher.id };
  }
  return { lifecycleRequired: true };
}

export async function recoverInfrastructure({ rows, patch, github, now = Date.now(), dryRun = false, requiredPin }) {
  const candidates = await rows('qa_candidates', {
    select: 'id,winget_id,version,architecture,status,test_level,failure_summary,finished_at,github_run_id,github_run_url,attempts,next_retry_at,recovery_attempts,recovery_history,test_config,package_profile_sha256,installer_sha256',
    status: 'eq.error', test_level: 'eq.psadt-package',
    finished_at: `gte.${new Date(now - 28 * 24 * 60 * 60_000).toISOString()}`,
    next_retry_at: `lte.${new Date(now).toISOString()}`,
    order: 'finished_at.asc', limit: '100',
    // Exclude non-infrastructure errors before paging so they cannot starve recovery.
    or: '(failure_summary.eq.' + PUBLICATION_FAILURE + ',failure_summary.eq.The QA workflow completed without reporting a terminal candidate result.,failure_summary.like.The installer source remained unavailable after*)',
  });
  for (const c of candidates) {
    const kind = recoveryKind(c);
    if (!kind) continue;
    if (Date.parse(c.finished_at) > now - 5 * 60_000) continue;
    const recoveryAttempts = c.recovery_attempts || 0;
    const [appBlocks, exclusions, payloadBlocks, securityResults, otherWork, latestResult] = await Promise.all([
      rows('package_eligibility_blocks', { select: 'winget_id', winget_id: `eq.${c.winget_id}`, limit: '1' }),
      rows('curated_excluded_apps', { select: 'winget_id', winget_id: `eq.${c.winget_id}`, limit: '1' }),
      rows('qa_package_blocks', { select: 'winget_id', winget_id: `eq.${c.winget_id}`, version: `eq.${c.version}`, architecture: `eq.${c.architecture}`, installer_sha256: `eq.${c.installer_sha256}`, limit: '1' }),
      rows('qa_package_results', { select: 'virustotal_malicious,virustotal_suspicious', winget_id: `eq.${c.winget_id}`, installer_sha256: `eq.${c.installer_sha256}`, or: '(virustotal_malicious.gt.0,virustotal_suspicious.gt.0)', limit: '1' }),
      rows('qa_candidates', { select: 'id', id: `neq.${c.id}`, winget_id: `eq.${c.winget_id}`, version: `eq.${c.version}`, architecture: `eq.${c.architecture}`, installer_sha256: `eq.${c.installer_sha256}`, package_profile_sha256: `eq.${c.package_profile_sha256}`, status: 'in.(queued,dispatched,running,passed)', limit: '1' }),
      rows('qa_results', { select: 'tested_at_utc,tested_version', winget_id: `eq.${c.winget_id}`, limit: '1' }),
    ]);
    if (appBlocks.length || exclusions.length || payloadBlocks.length || securityResults.length) {
      if (!dryRun) await patch('qa_candidates', { id: `eq.${c.id}`, status: 'eq.error' }, {
        status: 'superseded', updated_at: new Date(now).toISOString(),
        failure_summary: 'This app version is not available for automated deployment.',
      });
      continue;
    }
    if (otherWork.length || (c.test_config?.profileKind === 'catalog-default' &&
        Date.parse(latestResult[0]?.tested_at_utc) > Date.parse(c.finished_at))) {
      if (!dryRun) await patch('qa_candidates', { id: `eq.${c.id}`, status: 'eq.error' }, {
        status: 'superseded', updated_at: new Date(now).toISOString(),
        failure_summary: 'A newer QA candidate or result already covers this application.',
      });
      continue;
    }
    if (recoveryAttempts >= 5 && kind !== 'source') return { action: 'recovery_exhausted', candidateId: c.id, repairRequired: true };
    if (dryRun) return { action: 'would_recover_infrastructure', candidateId: c.id, kind };

    let job = null;
    if (kind === 'publication') {
      job = await publicationJob(c.github_run_id, github);
      if (job.waiting) continue;
    }
    if (!job?.jobId) {
      let profile;
      const canonical = c.test_config?.packageProfileCanonicalJson;
      try { profile = JSON.parse(canonical); } catch { return { action: 'recovery_profile_invalid', candidateId: c.id, repairRequired: true }; }
      if (profile?.toolchain?.packagerCommit !== requiredPin) {
        // Rebuild obsolete profiles through the ordinary authenticated scheduler.
        return { action: 'recovery_needs_current_profile', candidateId: c.id, wingetId: c.winget_id };
      }
      if (typeof canonical !== 'string' || createHash('sha256').update(canonical).digest('hex').toUpperCase() !== c.package_profile_sha256) {
        return { action: 'recovery_profile_invalid', candidateId: c.id, repairRequired: true };
      }
    }
    const event = { at: new Date(now).toISOString(), kind, previousRunId: c.github_run_id,
      previousSummary: c.failure_summary, previousAttempts: c.attempts };
    const history = [...(Array.isArray(c.recovery_history) ? c.recovery_history : []), event].slice(-20);
    const retryAt = new Date(now + retryDelayMs(recoveryAttempts + 1)).toISOString();
    const values = {
      status: job?.jobId ? 'running' : 'queued',
      recovery_attempts: recoveryAttempts + 1, recovery_history: history,
      next_retry_at: retryAt, finished_at: null, failure_summary: null,
      phase: job?.jobId ? 'publishing' : null,
      phase_started_at: job?.jobId ? new Date(now).toISOString() : null,
      phase_updated_at: job?.jobId ? new Date(now).toISOString() : null,
      started_at: job?.jobId ? new Date(now).toISOString() : null,
      updated_at: new Date(now).toISOString(),
      ...(job?.jobId ? {} : { attempts: 0, dispatched_at: null, github_run_id: null, github_run_url: null,
        live_activity: null, activity_updated_at: null, live_log: null, log_updated_at: null }),
    };
    const claimed = await patch('qa_candidates', { id: `eq.${c.id}`, status: 'eq.error', recovery_attempts: `eq.${recoveryAttempts}` }, values);
    if (claimed.length !== 1) return { action: 'recovery_claim_lost' };
    if (job?.jobId) {
      try { await github(`/actions/jobs/${job.jobId}/rerun`, { method: 'POST', body: '{}' }); }
      catch (error) {
        // A network timeout can follow an accepted POST. Retain the active lease
        // in that case; normal stale-run reconciliation verifies GitHub before release.
        if (error.httpStatus && error.httpStatus < 500) {
          await patch('qa_candidates', { id: `eq.${c.id}`, status: 'eq.running', recovery_attempts: `eq.${recoveryAttempts + 1}` }, {
            status: 'error', finished_at: c.finished_at, failure_summary: c.failure_summary,
            next_retry_at: error.retryAt || retryAt, updated_at: new Date(now).toISOString(),
          });
        }
        throw error;
      }
    }
    return { action: job?.jobId ? 'publication_retry_started' : 'infrastructure_retry_queued', candidateId: c.id, kind, nextRetryAt: retryAt };
  }
  return { action: 'no_recovery_due' };
}
