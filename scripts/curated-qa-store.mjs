// Supabase persistence for the curated automation: one history row per
// verification run (release and custom PSADT configuration runs, pass and
// fail), and the lifecycle of custom configuration verifications.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const CONFIG_RUN = /\[config:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*$/;
const RELEASE_RUN = /\[([a-f0-9]{24})\]\s*$/;
// Steps before the package lifecycle are infrastructure, not configuration.
const INFRASTRUCTURE_STEP = /^(guestIdentity|metadata|defenderUpdate|defenderStatus|download|signature|scan|inspectionReport|template)/;
const HISTORY_BATCH = 25;
const CONFIG_RETRY_MS = 2 * 3_600_000;
const LOST_DISPATCH_MS = 3 * 3_600_000;

export const supabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, signal: AbortSignal.timeout(30_000),
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} returned HTTP ${response.status}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

const parseJson = (value, fallback) => {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};
const bounded = (value, length = 600) => typeof value === 'string' && value ? value.slice(0, length) : null;

/** Maps one verification report to a curated_qa_runs row shaped like qa_results. */
export function historyRow(run, report, { apps, buildCuratedCartItem }) {
  const app = apps.find(item => item.id === report.candidate?.appId);
  if (!app) return null;
  const configId = CONFIG_RUN.exec(run.display_title || '')?.[1] || null;
  const input = report.profile?.workflowInput || {};
  const current = report.inspection?.current;
  let installCommand = null;
  try {
    const sha = current?.installerSha256 || report.candidate.vendorSha256 || '0'.repeat(64);
    installCommand = buildCuratedCartItem(app, { id: `${app.id}:${report.candidate.id}`, candidate: report.candidate, installerSha256: sha }).installCommand;
  } catch { installCommand = null; }
  const passed = report.status === 'passed' && run.conclusion === 'success';
  return {
    github_run_id: String(run.id), github_run_attempt: run.run_attempt || 1,
    kind: configId ? 'config' : 'release', config_verification_id: configId,
    winget_id: app.packageId, app_id: app.id, display_name: app.name, publisher: app.publisher,
    tested_version: report.candidate.version, architecture: app.architecture,
    outcome: passed ? 'Passed' : 'Failed',
    tested_at_utc: report.qa?.testedAt || report.verifiedAt || run.updated_at,
    candidate_id: report.candidate.id,
    installer_type: app.installerType, installer_url: report.candidate.installerUrl,
    installer_sha256: current?.installerSha256 || null,
    install_command: installCommand, uninstall_command: input.uninstallCommand || null,
    silent_args: input.silentSwitches ?? app.silentArgs,
    detection: parseJson(input.detectionRules, []), phase_results: report.qa?.phases || {},
    psadt_config: parseJson(input.psadtConfig, null), psadt_config_sha256: report.profile?.psadtConfigSha256 || null,
    package_profile_sha256: report.profile?.executionProfileSha256 || null, packager_commit: report.qa?.packagerCommit || report.profile?.packagerCommit || null,
    upgrade_from_version: report.previous?.version || null,
    upgrade_tested: report.qa ? report.qa.upgrade?.tested !== false && Boolean(report.previous) : null,
    signature_status: current?.signature?.status || null, signer: current?.signature?.publisher || null,
    defender_status: current?.security?.status || null, defender_signature_version: current?.security?.signatureVersion || null,
    failed_phase: report.failedPhase || null, failed_step: report.failedStep || null,
    failed_message: bounded(report.failedMessage || report.failedErrorId), failed_lifecycle: bounded(report.failedLifecycle),
    failed_signature: bounded(report.failedSignature, 200), failed_location: bounded(report.failedLocation, 120),
    workflow_commit: report.provenance?.workflowCommit || run.head_sha || null, website_commit: report.provenance?.websiteCommit || null,
    github_run_url: run.html_url,
  };
}

/** Records completed runs that are not stored yet; the backlog drains a batch per tick. */
export async function syncHistory(runs, readEvidence, context) {
  const completed = runs.filter(run => run.status === 'completed' && (RELEASE_RUN.test(run.display_title || '') || CONFIG_RUN.test(run.display_title || '')));
  if (!completed.length) return 0;
  const stored = await rest(`curated_qa_runs?select=github_run_id,github_run_attempt&github_run_id=in.(${completed.map(run => run.id).join(',')})`);
  const known = new Set((stored || []).map(row => `${row.github_run_id}:${row.github_run_attempt}`));
  const rows = [];
  for (const run of completed) {
    if (rows.length >= HISTORY_BATCH) break;
    if (known.has(`${run.id}:${run.run_attempt || 1}`)) continue;
    let report;
    try { report = (await readEvidence(run.id)).report; } catch { continue; }
    const row = historyRow(run, report, context);
    if (row) rows.push(row);
  }
  if (rows.length) await rest('curated_qa_runs?on_conflict=github_run_id,github_run_attempt', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates' });
  return rows.length;
}

const failureDetail = report => [report.failedStep, report.failedMessage, report.failedLifecycle].filter(Boolean).join('; ').slice(0, 500) || 'verification failed';

async function evidencePrevious(app, release) {
  const path = `catalog/curated/evidence/${app.id}/${release.candidate.id}.json`;
  if (!existsSync(path)) return null;
  try { return JSON.parse(await readFile(path, 'utf8')).previous || null; } catch { return null; }
}

/**
 * Advances custom PSADT configuration verifications: records finished runs,
 * dispatches queued requests and carries passed configurations forward to
 * each app's newest release so tenant auto-updates keep their settings.
 */
export async function processConfigVerifications({ runs, releases, apps, readEvidence, authenticate, dispatch, slots, now }) {
  const rows = await rest('curated_config_verifications?select=*&status=in.(requested,verifying,passed)&order=requested_at.asc');
  const states = []; let dispatched = 0;
  const update = (id, patch) => rest(`curated_config_verifications?id=eq.${id}`, { method: 'PATCH', body: { ...patch, updated_at: now.toISOString() } });

  // Carry passed configurations forward to the newest release of each app.
  const newest = new Map();
  for (const release of releases) {
    const best = newest.get(release.candidate.appId);
    if (!best || Date.parse(release.approvedAt) > Date.parse(best.approvedAt)) newest.set(release.candidate.appId, release);
  }
  for (const row of rows.filter(item => item.status === 'passed')) {
    const latest = newest.get(row.app_id);
    if (!latest || latest.id === row.release_id || rows.some(item => item.release_id === latest.id && item.psadt_config_sha256 === row.psadt_config_sha256)) continue;
    await rest('curated_config_verifications?on_conflict=release_id,psadt_config_sha256', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: [{
      release_id: latest.id, app_id: row.app_id, winget_id: row.winget_id, version: latest.candidate.version,
      psadt_config_sha256: row.psadt_config_sha256, psadt_config: row.psadt_config, status: 'requested', tenant_id: row.tenant_id, requested_by_user_id: row.requested_by_user_id,
    }] });
    rows.push({ ...row, id: null, release_id: latest.id, status: 'requested', carried: true });
  }

  for (const row of rows) {
    if (row.status === 'passed' || !row.id) continue;
    const release = releases.find(item => item.id === row.release_id);
    const app = apps.find(item => item.id === row.app_id);
    if (!release || !app) { await update(row.id, { status: 'failed', failure_detail: 'The curated release is no longer available.' }); continue; }
    const run = runs.find(item => CONFIG_RUN.exec(item.display_title || '')?.[1] === row.id);
    if (row.status === 'verifying') {
      if (run && run.status !== 'completed') { states.push(`${app.name} custom settings ${row.psadt_config_sha256.slice(0, 8)}: verifying`); continue; }
      if (!run) {
        if (now.getTime() - Date.parse(row.updated_at) > LOST_DISPATCH_MS) await update(row.id, { status: 'requested', github_run_id: null });
        continue;
      }
      let report = null;
      try { report = (await readEvidence(run.id)).report; } catch { report = null; }
      if (run.conclusion === 'success' && report) {
        try {
          await authenticate(run, report);
          if (report.candidate?.id !== release.candidate.id || report.inspection?.current?.installerSha256 !== release.installerSha256 ||
              report.profile?.psadtConfigSha256 !== row.psadt_config_sha256 || report.status !== 'passed' || report.vmRestored !== true ||
              !Object.values(report.qa?.phases || {}).every(phase => phase?.passed === true)) throw new Error('The run did not test this exact release and configuration.');
          await update(row.id, { status: 'passed', github_run_id: String(run.id), execution_profile_sha256: report.profile.executionProfileSha256.toLowerCase(), packager_commit: report.qa.packagerCommit, verified_at: now.toISOString(), failure_detail: null });
          states.push(`${app.name} custom settings ${row.psadt_config_sha256.slice(0, 8)}: passed`);
          continue;
        } catch (error) { report = { ...report, failedStep: 'approval', failedMessage: error.message }; }
      }
      // Failures before the package lifecycle are infrastructure and retried;
      // lifecycle failures belong to the configuration and are final.
      if (!report || INFRASTRUCTURE_STEP.test(report.failedStep || '')) await update(row.id, { status: 'requested', github_run_id: null, failure_detail: report ? failureDetail(report) : 'no evidence' });
      else await update(row.id, { status: 'failed', github_run_id: String(run.id), failure_detail: failureDetail(report) });
      states.push(`${app.name} custom settings ${row.psadt_config_sha256.slice(0, 8)}: ${report && !INFRASTRUCTURE_STEP.test(report.failedStep || '') ? 'failed' : 'retrying'}`);
      continue;
    }
    // requested
    if (row.github_run_id === null && row.failure_detail && now.getTime() - Date.parse(row.updated_at) < CONFIG_RETRY_MS) continue;
    if (dispatched >= slots) { states.push(`${app.name} custom settings ${row.psadt_config_sha256.slice(0, 8)}: queued`); continue; }
    const previous = await evidencePrevious(app, release);
    if (!previous && app.autoUpdate !== 'vendor-managed') { await update(row.id, { status: 'failed', failure_detail: 'No earlier release is available for the upgrade test.' }); continue; }
    dispatch({
      app_label: `${app.name} ${release.candidate.version} ${app.architecture} custom settings [config:${row.id}]`,
      candidate: JSON.stringify(release.candidate), previous: previous ? JSON.stringify(previous) : '',
      psadt_config: JSON.stringify(row.psadt_config),
    });
    await update(row.id, { status: 'verifying' });
    dispatched++;
    states.push(`${app.name} custom settings ${row.psadt_config_sha256.slice(0, 8)}: verification dispatched`);
  }
  return { states, dispatched };
}
