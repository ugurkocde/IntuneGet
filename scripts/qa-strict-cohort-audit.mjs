import { createHash } from 'node:crypto';
const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || new URL(base).hostname !== 'mbhajocqtogfbgojkwhd.supabase.co' || !key) throw new Error('Production environment required');
const boundary = '2026-08-30T08:28:35Z';
async function rows(table, params) {
  const all = [];
  for (let offset = 0; ; offset += 500) {
    const response = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams({...params, offset: String(offset), limit: '500'})}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Read failed: ${table} ${response.status}`);
    const page = await response.json(); all.push(...page);
    if (page.length < 500) return all;
  }
}
const [controls, candidates, results] = await Promise.all([
  rows('qa_pipeline_control', {id: 'eq.global', select: 'required_packager_commit,scheduler_packager_commit,paused'}),
  rows('qa_candidates', {status: 'eq.passed', test_level: 'eq.psadt-package', order: 'id.asc', select: 'id,winget_id,version,architecture,installer_sha256,package_profile_sha256,finished_at,test_config,github_run_id'}),
  rows('qa_package_results', {outcome: 'eq.Passed', order: 'package_profile_sha256.asc', select: 'winget_id,tested_version,architecture,installer_sha256,package_profile_sha256,outcome,phase_results,environment,packager_commit,tested_at_utc,virustotal_malicious,virustotal_suspicious,github_run_id'}),
]);
const norm = s => String(s || '').trim().toLowerCase();
const byProfile = new Map(results.map(r=>[norm(r.package_profile_sha256), r]));
const reasons = {};
const strict = [];
for (const c of candidates) {
  const r = byProfile.get(norm(c.package_profile_sha256));
  let why;
  let profile;
  try { profile = JSON.parse(c.test_config.packageProfileCanonicalJson); } catch { why = 'missingCanonicalProfile'; }
  const phases = r?.phase_results;
  if (!why && !r) why = 'missingExactResult';
  if (!why && (norm(c.winget_id) !== norm(r.winget_id) || c.version !== r.tested_version || c.architecture !== r.architecture || norm(c.installer_sha256) !== norm(r.installer_sha256))) why = 'tupleMismatch';
  if (!why && (createHash('sha256').update(c.test_config.packageProfileCanonicalJson).digest('hex') !== norm(c.package_profile_sha256) || norm(profile.installer?.sha256) !== norm(c.installer_sha256))) why = 'profileHashMismatch';
  if (!why && (phases?.install?.exitCode !== 0 || phases?.detectionAfterInstall?.exitCode !== 0 || phases?.uninstall?.exitCode !== 0 || phases?.detectionAfterUninstall?.exitCode !== 1)) why = 'lifecycleTuple';
  if (!why && r.environment?.executionContext !== 'LocalSystem') why = 'executionContext';
  if (!why && (r.virustotal_malicious !== 0 || r.virustotal_suspicious !== 0)) why = 'virusTotalNotZeroZero';
  if (!why && norm(profile.toolchain?.packagerCommit) !== norm(r.packager_commit)) why = 'resultPinMismatch';
  if (why) {reasons[why] = (reasons[why] || 0)+1; continue;}
  strict.push({c,r});
}
const historical = new Set(strict.filter(({c})=>Date.parse(c.finished_at)<=Date.parse(boundary)).map(({c})=>norm(c.winget_id)));
const eligible = strict.filter(({c,r})=>Date.parse(c.finished_at)>Date.parse(boundary) && !historical.has(norm(c.winget_id)) && norm(r.packager_commit)===norm(controls[0].required_packager_commit));
console.log(JSON.stringify({observedAtUtc:new Date().toISOString(), boundary, requiredPin:controls[0].required_packager_commit,
  strictCount:new Set(eligible.map(({c})=>norm(c.winget_id))).size,
  latestStrictFinish:eligible.map(({c})=>c.finished_at).sort().at(-1)||null,
  auditedPassedCandidates:candidates.length, strictEvidenceCandidates:strict.length, rejectedReasons:reasons,
  currentPinStrictIds:[...new Set(eligible.map(({c})=>c.winget_id))]},null,2));
