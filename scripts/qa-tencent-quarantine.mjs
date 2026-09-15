// Reviewed exact-payload containment. Run with the existing production environment.
// No installer access, arbitrary commands, or customer configuration output.
import { createHash } from 'node:crypto';
const action = process.argv[2] || 'audit';
if (!['audit', 'block', 'resume'].includes(action)) throw new Error('Unknown action');
const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const pin = '6dfeaea03893e63cf7aba747638d7ea1768ac6b7';
const candidateId = 'e2927f23-1ad4-4143-b7ac-c04a755ec930';
const profileHash = 'F9507BB1623E72D7E4AEBE0932DFF0973D540E670E9441BAE92688724EAD1662';
const tuple = { winget_id: 'Tencent.ima-copilot', version: '2.6.10.5128', architecture: 'x64',
  installer_sha256: '37E79B29536B79F0DB0F203CD9135A196F5A9791D446F7B16E2A3C1FE75F9EB9' };
if (!base || new URL(base).hostname !== 'mbhajocqtogfbgojkwhd.supabase.co' || !key) throw new Error('Production environment required');
async function request(table, params, method = 'GET', body, prefer = 'return=representation') {
  const response = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(params)}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${table} HTTP ${response.status}`);
  return response.json();
}
const tupleFilter = Object.fromEntries(Object.entries(tuple).map(([k,v]) => [k, `eq.${v}`]));
async function guard() {
  const [controls, active] = await Promise.all([
    request('qa_pipeline_control', { id: 'eq.global', select: 'paused,reason,updated_at,required_packager_commit,scheduler_packager_commit,scheduler_seen_at' }),
    request('qa_candidates', { status: 'in.(dispatched,running)', select: 'id' }),
  ]);
  const c = controls[0];
  if (controls.length !== 1 || !c.paused || active.length || c.required_packager_commit !== pin || c.scheduler_packager_commit !== pin ||
    !c.reason?.includes(`candidate ${candidateId}.`)) throw new Error('Exact Tencent pause, zero active lifecycles and aligned pin required');
  return c;
}
const control = await guard();
const [candidates, results] = await Promise.all([
  request('qa_candidates', { ...tupleFilter, id: `eq.${candidateId}`, status: 'eq.failed', test_level: 'eq.psadt-package',
    select: 'id,github_run_id,package_profile_sha256,test_config,finished_at' }),
  request('qa_package_results', { winget_id: `eq.${tuple.winget_id}`, tested_version: `eq.${tuple.version}`, architecture: 'eq.x64',
    installer_sha256: `eq.${tuple.installer_sha256}`, package_profile_sha256: `eq.${profileHash}`,
    select: 'outcome,phase_results,environment,packager_commit,github_run_id,virustotal_malicious,virustotal_suspicious' }),
]);
const c = candidates[0], r = results[0], phases = r?.phase_results;
const canonical = c?.test_config?.packageProfileCanonicalJson;
const profile = JSON.parse(canonical || '{}');
if (action === 'audit') console.log(JSON.stringify({ candidateCount: candidates.length, resultCount: results.length,
  candidateRun: c?.github_run_id, resultRun: r?.github_run_id, storedProfileHash: c?.package_profile_sha256,
  recomputedProfileHash: canonical ? createHash('sha256').update(canonical).digest('hex').toUpperCase() : null,
  profilePin: profile.toolchain?.packagerCommit, profileInstallerSha: profile.installer?.sha256,
  resultPin: r?.packager_commit, outcome: r?.outcome, context: r?.environment?.executionContext,
  phaseExits: [phases?.install?.exitCode, phases?.detectionAfterInstall?.exitCode, phases?.uninstall?.exitCode, phases?.detectionAfterUninstall?.exitCode],
  virusTotal: [r?.virustotal_malicious, r?.virustotal_suspicious] }));
// The result table can omit run metadata; bind its exact profile and installer
// hashes to the candidate and reject any conflicting run metadata when present.
if (candidates.length !== 1 || results.length !== 1 || c.github_run_id !== '34988617135' || (r.github_run_id != null && String(r.github_run_id) !== c.github_run_id) ||
  c.package_profile_sha256 !== profileHash || !c.finished_at || !canonical ||
  createHash('sha256').update(canonical).digest('hex').toUpperCase() !== profileHash ||
  profile.toolchain?.packagerCommit !== pin || profile.installer?.sha256?.toUpperCase() !== tuple.installer_sha256 ||
  r.packager_commit !== pin || r.outcome !== 'Failed' || r.environment?.executionContext !== 'LocalSystem' ||
  phases?.install?.exitCode !== 0 || phases?.detectionAfterInstall?.exitCode !== 0 || phases?.uninstall?.exitCode !== 60001 || phases?.detectionAfterUninstall?.exitCode !== 0) throw new Error('Exact failed lifecycle evidence mismatch');
// Containment never grants a pass or a reputation exemption. Missing or flagged
// VirusTotal evidence remains unchanged and must not prevent a restrictive block.
if (action === 'block') {
  await guard();
  await request('qa_package_blocks', { on_conflict: 'winget_id,version,architecture,installer_sha256' }, 'POST', {
    ...tuple, block_code: 'failed_managed_lifecycle',
    detail: 'Isolated PSADT run 34988617135 returned 0/0/60001/0 under LocalSystem. The exact ima.copilot registration remained after the 310-second completion deadline for Application/uninstall/ImaUninstall.exe --uninstall --verbose-logging. WinGet documents quiet installation but no unattended removal contract was established. This exact payload requires a reviewed managed lifecycle repair and controlled retest before release. Reputation evidence is unchanged; no strict pass is granted.',
  }, 'resolution=ignore-duplicates,return=representation');
}
const blocks = await request('qa_package_blocks', { ...tupleFilter, select: 'block_code' });
if (action !== 'audit' && (blocks.length !== 1 || blocks[0].block_code !== 'failed_managed_lifecycle')) throw new Error('Shared quarantine not verified');
if (action === 'block') {
  await guard();
  await request('qa_candidates', { ...tupleFilter, status: 'eq.queued', dispatched_at: 'is.null', github_run_id: 'is.null' }, 'PATCH', {
    status: 'superseded', finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    failure_summary: 'This app version is not available for automated deployment.',
  });
}
if (action === 'resume') {
  const fresh = await guard();
  if (!Number.isFinite(Date.parse(fresh.scheduler_seen_at)) || Date.now() - Date.parse(fresh.scheduler_seen_at) > 300000) throw new Error('Fresh scheduler heartbeat required');
  const updated = await request('qa_pipeline_control', { id: 'eq.global', paused: 'eq.true', reason: `eq.${fresh.reason}`,
    updated_at: `eq.${fresh.updated_at}`, required_packager_commit: `eq.${pin}`, scheduler_packager_commit: `eq.${pin}`,
    scheduler_seen_at: `gte.${new Date(Date.now() - 300000).toISOString()}` }, 'PATCH', {
    paused: false, reason: null, updated_at: new Date().toISOString(), updated_by: 'qa-tencent-shared-quarantine',
  });
  if (updated.length !== 1) throw new Error('Guarded resume did not match');
}
console.log(JSON.stringify({ observedAtUtc: new Date().toISOString(), action, ...tuple, candidateId,
  run: c.github_run_id, pin, tuple: [0,0,60001,0], block: blocks[0]?.block_code || null,
  paused: action === 'resume' ? false : control.paused, strictPass: false }));
