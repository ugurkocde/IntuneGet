import { writeFile, rename } from 'node:fs/promises';
import { recoverInfrastructure, rateLimitUntil } from './recovery.mjs';

const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.CRON_SECRET;
const isDryRun = process.argv.includes('--dry-run');
const stateFlagIndex = process.argv.indexOf('--state');
const statePath = stateFlagIndex >= 0 ? process.argv[stateFlagIndex + 1] : null;
const siteBase = 'https://www.intuneget.com';
const heartbeatFreshMs = 5 * 60 * 1000;
const heartbeatRefreshMs = 4 * 60 * 1000;
const activeReconcileMs = 10 * 60 * 1000;
const shaPattern = /^[0-9a-f]{40}$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!base || !serviceKey || !cronSecret) {
  throw new Error('Missing production Supabase or cron environment variables.');
}
if (stateFlagIndex >= 0 && !statePath) {
  throw new Error('--state requires a file path.');
}

const restHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  'User-Agent': 'IntuneGet-QA-Supervisor/2.0',
  'X-Client-Info': 'intuneget-qa-supervisor',
};

const result = {
  ok: false,
  dryRun: isDryRun,
  observedAtUtc: new Date().toISOString(),
  action: 'none',
  actions: [],
  repairRequired: false,
  repairKey: null,
  repairReason: null,
  snapshot: null,
  error: null,
  errorKind: null,
  retryAt: null,
};

async function persist() {
  const value = `${JSON.stringify(result, null, 2)}\n`;
  if (statePath) {
    await writeFile(`${statePath}.${process.pid}.tmp`, value, 'utf8');
    await rename(`${statePath}.${process.pid}.tmp`, statePath);
  }
  process.stdout.write(value);
}

function queryString(values) {
  return new URLSearchParams(values).toString();
}

async function rest(path, init = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { ...restHeaders, ...(init.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    let code;
    try { code = JSON.parse(detail).code; } catch { /* Non-JSON gateway failure. */ }
    throw Object.assign(new Error(`Supabase REST ${response.status}: ${detail}`), { code });
  }
  return response;
}

async function rows(table, params) {
  const response = await rest(`${table}?${queryString(params)}`);
  return response.json();
}

async function patch(table, params, value) {
  try {
    const response = await rest(`${table}?${queryString(params)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(value),
    });
    return response.json();
  } catch (error) {
    // The ordinary dispatcher can win the single-flight index while recovery
    // is checking GitHub. Losing that claim is healthy concurrency, not failure.
    if (table === 'qa_candidates' && params.status === 'eq.error' && error.code === '23505') return [];
    throw error;
  }
}

async function github(path, init = {}) {
  const [budget] = await rows('qa_automation_state', { id: 'eq.github-recovery-budget', select: 'value' });
  if (Date.parse(budget?.value?.retryAt || '') > Date.now()) {
    throw Object.assign(new Error('GitHub API cooldown is active.'), { retryAt: budget.value.retryAt, httpStatus: 429 });
  }
  const token = process.env.GITHUB_PAT;
  const owner = process.env.GITHUB_OWNER;
  const repository = process.env.GITHUB_WORKFLOWS_REPO;
  if (!token || !owner || !repository) throw new Error('GitHub recovery configuration is missing.');
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(20_000),
  });
  const retryAt = rateLimitUntil(response);
  if (retryAt) {
    await rest('qa_automation_state?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ id: 'github-recovery-budget', value: { retryAt }, updated_at: new Date().toISOString() }) });
  }
  if (!response.ok) throw Object.assign(new Error(`GitHub recovery returned ${response.status}.`), { httpStatus: response.status, retryAt });
  return response.status === 204 ? null : response.json();
}

async function exactCount(table, params) {
  const response = await rest(`${table}?${queryString(params)}`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const match = (response.headers.get('content-range') || '').match(/\/(\d+)$/);
  if (!match) throw new Error(`Could not read exact ${table} count.`);
  return Number(match[1]);
}

async function snapshot() {
  const candidateSelect = [
    'id',
    'winget_id',
    'version',
    'architecture',
    'status',
    'phase',
    'github_run_id',
    'failure_summary',
    'updated_at',
    'phase_updated_at',
    'activity_updated_at',
    'finished_at',
    'test_level',
  ].join(',');
  const [controlRows, active, queuedCount, nextQueue] = await Promise.all([
    rows('qa_pipeline_control', {
      select: 'id,paused,reason,updated_at,updated_by,required_packager_commit,scheduler_packager_commit,scheduler_seen_at',
      id: 'eq.global',
    }),
    rows('qa_candidates', {
      select: candidateSelect,
      status: 'in.(dispatched,running)',
      test_level: 'eq.psadt-package',
      order: 'updated_at.desc',
    }),
    exactCount('qa_candidates', {
      select: 'id',
      status: 'eq.queued',
      test_level: 'eq.psadt-package',
    }),
    rows('qa_candidates', {
      select: 'id,winget_id,version,architecture,priority,enqueued_at',
      status: 'eq.queued',
      test_level: 'eq.psadt-package',
      order: 'priority.desc,enqueued_at.asc',
      limit: '3',
    }),
  ]);
  if (controlRows.length !== 1) throw new Error('QA pipeline control row is missing or duplicated.');
  if (active.length > 1) throw new Error(`Single-flight invariant violated: ${active.length} active candidates.`);
  return { control: controlRows[0], active, queuedCount, nextQueue };
}

async function invokeCron(route) {
  const response = await fetch(`${siteBase}${route}`, {
    headers: { authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(295_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text: text.slice(0, 1_000) };
  }
  if (!response.ok) {
    throw new Error(`${route} returned ${response.status}: ${JSON.stringify(body).slice(0, 1_000)}`);
  }
  return { status: response.status, body };
}

function heartbeatAgeMs(control) {
  if (!control.scheduler_seen_at) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(control.scheduler_seen_at);
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function activeAgeMs(candidate) {
  const value = candidate.activity_updated_at || candidate.phase_updated_at || candidate.updated_at;
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

function securityCandidateId(control) {
  const reason = typeof control.reason === 'string' ? control.reason : '';
  if (!/VirusTotal blocked the exact installer after \d+ malicious verdict/i.test(reason)) return null;
  const match = reason.match(/candidate ([0-9a-f-]{36})\./i);
  return match && uuidPattern.test(match[1]) ? match[1] : null;
}

async function validateTerminalSecurityPause(control) {
  const candidateId = securityCandidateId(control);
  if (!candidateId) return { valid: false, reason: 'Pause is not a recognized terminal VirusTotal quarantine.' };
  const candidateRows = await rows('qa_candidates', {
    select: 'id,winget_id,version,architecture,status,failure_summary,finished_at,test_level',
    id: `eq.${candidateId}`,
  });
  const candidate = candidateRows[0];
  if (!candidate) return { valid: false, reason: 'The quarantined candidate no longer exists.', candidateId };
  if (
    candidate.status !== 'failed' ||
    candidate.test_level !== 'psadt-package' ||
    !candidate.finished_at ||
    !/VirusTotal blocked the exact installer after \d+ malicious verdict/i.test(candidate.failure_summary || '')
  ) {
    return { valid: false, reason: 'The security candidate is not a terminal failed PSADT VirusTotal result.', candidateId, candidate };
  }
  const required = control.required_packager_commit;
  const scheduler = control.scheduler_packager_commit;
  if (!shaPattern.test(required || '') || required.toLowerCase() !== (scheduler || '').toLowerCase()) {
    return { valid: false, reason: 'Required and scheduler packager commits are not exactly aligned.', candidateId, candidate };
  }
  if (heartbeatAgeMs(control) > heartbeatFreshMs) {
    return { valid: false, reason: 'The production scheduler heartbeat is not fresh.', candidateId, candidate };
  }
  return { valid: true, candidateId, candidate, commit: required.toLowerCase() };
}

async function guardedResume(commit) {
  const cutoff = new Date(Date.now() - heartbeatFreshMs).toISOString();
  const params = queryString({
    id: 'eq.global',
    paused: 'eq.true',
    required_packager_commit: `eq.${commit}`,
    scheduler_packager_commit: `eq.${commit}`,
    scheduler_seen_at: `gte.${cutoff}`,
  });
  const response = await rest(`qa_pipeline_control?${params}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      paused: false,
      reason: null,
      updated_at: new Date().toISOString(),
      updated_by: 'qa-supervisor-security-quarantine',
    }),
  });
  const updated = await response.json();
  return updated.length === 1;
}

function requireRepair(reason, key = 'pipeline-control') {
  result.repairRequired = true;
  result.repairKey = key;
  result.repairReason = reason;
  result.action = 'repair_required';
}

try {
  let current = await snapshot();
  result.snapshot = current;

  if (current.control.paused) {
    if (isDryRun) {
      const validation = await validateTerminalSecurityPause(current.control);
      if (validation.valid && current.active.length === 0) {
        result.action = 'would_resume_security_quarantine_and_dispatch';
        result.actions.push({ type: 'would_refresh_scheduler_heartbeat' });
        result.actions.push({ type: 'would_guardedly_resume', candidateId: validation.candidateId });
        if (current.queuedCount > 0) result.actions.push({ type: 'would_dispatch' });
      } else {
        requireRepair(validation.reason, validation.candidateId || 'pipeline-control');
      }
      result.ok = true;
      await persist();
      process.exit(0);
    }

    if (heartbeatAgeMs(current.control) >= heartbeatRefreshMs) {
      const heartbeat = await invokeCron('/api/cron/qa-enqueue');
      result.actions.push({ type: 'scheduler_heartbeat', status: heartbeat.status, body: heartbeat.body });
    } else {
      result.actions.push({ type: 'scheduler_heartbeat_already_fresh' });
    }
    current = await snapshot();
    result.snapshot = current;

    if (current.active.length !== 0) {
      requireRepair('The pipeline is paused but an active lifecycle still exists.', current.active[0]?.id || 'active-while-paused');
    } else {
      const validation = await validateTerminalSecurityPause(current.control);
      if (!validation.valid) {
        requireRepair(validation.reason, validation.candidateId || 'pipeline-control');
      } else if (!(await guardedResume(validation.commit))) {
        current = await snapshot();
        result.snapshot = current;
        if (current.control.paused) requireRepair('The guarded security-quarantine resume compare-and-set returned no row.', validation.candidateId);
      } else {
        result.actions.push({ type: 'security_quarantine_preserved', candidateId: validation.candidateId });
        result.actions.push({ type: 'pipeline_resumed', commit: validation.commit });
        current = await snapshot();
        result.snapshot = current;
      }
    }
  }

  if (!result.repairRequired && !result.snapshot.control.paused) {
    current = result.snapshot;
    // A fresh heartbeat proves production has already attempted reconciliation.
    // Do not hammer an empty or low queue every two minutes.
    const refreshNeeded = heartbeatAgeMs(current.control) >= heartbeatRefreshMs;
    if (refreshNeeded) {
      if (isDryRun) {
        result.actions.push({ type: 'would_enqueue' });
      } else {
        const enqueued = await invokeCron('/api/cron/qa-enqueue');
        result.actions.push({ type: 'enqueue', status: enqueued.status, body: enqueued.body });
        current = await snapshot();
        result.snapshot = current;
      }
    }

    if (result.snapshot.active.length === 0) {
      const recovery = await recoverInfrastructure({ rows, patch, github, dryRun: isDryRun,
        requiredPin: result.snapshot.control.required_packager_commit });
      result.actions.push(recovery);
      if (recovery.action === 'recovery_needs_current_profile') {
        await invokeCron(`/api/cron/qa-enqueue?id=${encodeURIComponent(recovery.wingetId)}`);
        // Enqueue may return HTTP 200 with a per-app error. Retire the old
        // evidence only after an actual current-profile replacement exists.
        const replacements = await rows('qa_candidates', { select: 'id,test_config',
          id: `neq.${recovery.candidateId}`, winget_id: `eq.${recovery.wingetId}`,
          status: 'in.(queued,dispatched,running,passed)', test_level: 'eq.psadt-package',
          order: 'enqueued_at.desc', limit: '20' });
        const replaced = replacements.some(candidate => {
          try { return JSON.parse(candidate.test_config?.packageProfileCanonicalJson)?.toolchain?.packagerCommit === result.snapshot.control.required_packager_commit; }
          catch { return false; }
        });
        if (replaced) await patch('qa_candidates', { id: `eq.${recovery.candidateId}`, status: 'eq.error' }, {
            status: 'superseded', updated_at: new Date().toISOString(),
            failure_summary: 'Infrastructure retry superseded by a current package profile.',
          });
        else await patch('qa_candidates', { id: `eq.${recovery.candidateId}`, status: 'eq.error' }, {
          next_retry_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      if (recovery.repairRequired) {
        if (!isDryRun) await patch('qa_pipeline_control', { id: 'eq.global', paused: 'eq.false' }, {
          paused: true, reason: `QA infrastructure recovery requires review for candidate ${recovery.candidateId}.`,
          updated_by: 'qa-infrastructure-recovery', updated_at: new Date().toISOString(),
        });
        requireRepair(recovery.action, recovery.candidateId);
        result.snapshot = await snapshot();
        result.ok = true;
        await persist();
        process.exit(0);
      }
      result.snapshot = await snapshot();
    }
    const currentActive = result.snapshot.active[0] || null;
    if (!currentActive && result.snapshot.queuedCount > 0) {
      if (isDryRun) {
        result.action = 'would_dispatch';
        result.actions.push({ type: 'would_dispatch' });
      } else {
        const dispatched = await invokeCron('/api/cron/qa-dispatch');
        result.actions.push({ type: 'dispatch', status: dispatched.status, body: dispatched.body });
        result.action = dispatched.body?.dispatched ? 'dispatched' : (dispatched.body?.reason || 'dispatch_checked');
        result.snapshot = await snapshot();
      }
    } else if (currentActive && activeAgeMs(currentActive) >= activeReconcileMs) {
      if (isDryRun) {
        result.action = 'would_reconcile_active';
        result.actions.push({ type: 'would_reconcile_active', candidateId: currentActive.id });
      } else {
        const reconciled = await invokeCron('/api/cron/qa-dispatch');
        result.actions.push({ type: 'active_reconcile', status: reconciled.status, body: reconciled.body });
        result.action = reconciled.body?.reason || 'active_reconciled';
        result.snapshot = await snapshot();
      }
    } else {
      result.action = currentActive ? 'active_healthy' : 'idle_waiting_for_work';
    }
  }

  result.ok = true;
  await persist();
} catch (error) {
  result.error = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  result.action = 'controller_error';
  result.retryAt = error.retryAt || null;
  result.errorKind = error.retryAt || /(?:Supabase REST (?:408|429|5\d\d)|fetch failed|timed?\s*out|timeout|statement timeout|returned 50[234]|Cloudflare|522)/i.test(result.error)
    ? 'dependency_unavailable' : 'controller';
  await persist().catch(() => {});
  process.exitCode = 1;
}
