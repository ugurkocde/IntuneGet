// Guarded operational rollout for the reviewed GreenTunnel repair; no installer access.
import { createHash } from 'node:crypto';
const [action, pin] = process.argv.slice(2);
const oldPin = '6dfeaea03893e63cf7aba747638d7ea1768ac6b7';
const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || new URL(base).hostname !== 'mbhajocqtogfbgojkwhd.supabase.co' || !key || !/^[a-f0-9]{40}$/.test(pin || '')) throw new Error('Production environment and full reviewed pin required');
async function request(table, params, body) {
  const response = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(params)}`, {
    method: body ? 'PATCH' : 'GET',
    headers: {apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json', Prefer:'return=representation'},
    body: body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Production operation failed: ${table} ${response.status}`);
  return response.json();
}
async function pausedIdle() {
  const [control,active] = await Promise.all([
    request('qa_pipeline_control',{id:'eq.global',select:'paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at'}),
    request('qa_candidates',{status:'in.(dispatched,running)',select:'id'}),
  ]);
  if (control.length!==1 || !control[0].paused || active.length) throw new Error('Requires auto-paused production and zero active lifecycles');
  return control[0];
}
if (action==='pause-retry') {
  const active=await request('qa_candidates',{status:'in.(dispatched,running)',select:'id,winget_id,version,test_config'});
  if(active.length!==1 || active[0].winget_id!=='SadeghHayeri.GreenTunnel' || active[0].version!=='3.0.5' ||
    JSON.parse(active[0].test_config?.packageProfileCanonicalJson||'{}').toolchain?.packagerCommit!==pin) throw new Error('Exact active retry required');
  const updated=await request('qa_pipeline_control',{id:'eq.global',paused:'eq.false',required_packager_commit:`eq.${pin}`},
    {paused:true,reason:'Exact repaired application validation in progress.',updated_at:new Date().toISOString(),updated_by:'qa-greentunnel-retry-audit'});
  if(updated.length!==1) throw new Error('Pause guard failed');
  console.log(JSON.stringify({action,candidateId:active[0].id,paused:true}));
  process.exit(0);
}
const control = await pausedIdle();
if (action==='set-pin') {
  if (control.required_packager_commit!==oldPin) throw new Error('Unexpected prior pin');
  const updated=await request('qa_pipeline_control',{id:'eq.global',paused:'eq.true',required_packager_commit:`eq.${oldPin}`},
    {required_packager_commit:pin,updated_at:new Date().toISOString(),updated_by:'qa-greentunnel-reviewed-rollout'});
  if(updated.length!==1) throw new Error('Pin guard did not match');
  console.log(JSON.stringify({action,requiredPin:pin,paused:true}));
} else if (action==='retire-old-queue') {
  if(control.required_packager_commit!==pin) throw new Error('Required pin mismatch');
  const queue=await request('qa_candidates',{status:'eq.queued',dispatched_at:'is.null',github_run_id:'is.null',select:'id,package_profile_sha256,test_config',limit:'1000'});
  let count=0;
  for(const c of queue) {
    const profile=JSON.parse(c.test_config?.packageProfileCanonicalJson || '{}');
    if(profile.toolchain?.packagerCommit!==oldPin) continue;
    await pausedIdle();
    const updated=await request('qa_candidates',{id:`eq.${c.id}`,status:'eq.queued',dispatched_at:'is.null',github_run_id:'is.null',package_profile_sha256:`eq.${c.package_profile_sha256}`},
      {status:'superseded',finished_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    count+=updated.length;
  }
  console.log(JSON.stringify({action,supersededUndispatchedOldPin:count}));
} else if(action==='prioritize-retry' || action==='resume-retry') {
  if(control.required_packager_commit!==pin || control.scheduler_packager_commit!==pin || Date.now()-Date.parse(control.scheduler_seen_at)>300000) throw new Error('Fresh aligned scheduler pin required');
  const candidates=await request('qa_candidates',{winget_id:'eq.SadeghHayeri.GreenTunnel',version:'eq.3.0.5',architecture:'eq.x86',status:'eq.queued',installer_sha256:'eq.77CD4E08ABF2E7A0FC235821AE49BBFDD032616A9A0407902F907C96547D2659',select:'id,priority,test_config'});
  const matches=candidates.filter(c=>{
    const p=JSON.parse(c.test_config?.packageProfileCanonicalJson||'{}');
    return p.toolchain?.packagerCommit===pin && p.installer?.installScope==='user' &&
      /ba1bb1f3-0069-5c64-9a11-479ebc0471d9/i.test(p.installer?.uninstallCommand || '');
  });
  if(matches.length!==1) throw new Error('Exact repaired GreenTunnel candidate required');
  const candidate=matches[0];
  if(action==='prioritize-retry') {
    const updated=await request('qa_candidates',{id:`eq.${candidate.id}`,status:'eq.queued',dispatched_at:'is.null'},{priority:2000,updated_at:new Date().toISOString()});
    if(updated.length!==1) throw new Error('Retry priority guard failed');
    console.log(JSON.stringify({action,candidateId:candidate.id,priority:2000}));
  } else {
    const queue=await request('qa_candidates',{status:'eq.queued',select:'id',order:'priority.desc,enqueued_at.asc',limit:'1'});
    if(queue[0]?.id!==candidate.id) throw new Error('Exact retry must be first');
    const updated=await request('qa_pipeline_control',{id:'eq.global',paused:'eq.true',required_packager_commit:`eq.${pin}`,scheduler_packager_commit:`eq.${pin}`,scheduler_seen_at:`gte.${new Date(Date.now()-300000).toISOString()}`},
      {paused:false,reason:null,updated_at:new Date().toISOString(),updated_by:'qa-greentunnel-exact-retry'});
    if(updated.length!==1) throw new Error('Resume guard failed');
    console.log(JSON.stringify({action,candidateId:candidate.id,requiredPin:pin}));
  }
} else if(action==='complete-retry') {
  if(control.required_packager_commit!==pin || control.scheduler_packager_commit!==pin || Date.now()-Date.parse(control.scheduler_seen_at)>300000) throw new Error('Fresh aligned scheduler pin required');
  const hash='77CD4E08ABF2E7A0FC235821AE49BBFDD032616A9A0407902F907C96547D2659';
  const candidates=await request('qa_candidates',{winget_id:'eq.SadeghHayeri.GreenTunnel',version:'eq.3.0.5',architecture:'eq.x86',installer_sha256:`eq.${hash}`,status:'eq.passed',test_level:'eq.psadt-package',select:'id,package_profile_sha256,test_config'});
  const matching=candidates.filter(c=>JSON.parse(c.test_config?.packageProfileCanonicalJson||'{}').toolchain?.packagerCommit===pin);
  if(matching.length!==1) throw new Error('Exactly one passed repaired lifecycle required');
  if(createHash('sha256').update(matching[0].test_config.packageProfileCanonicalJson).digest('hex')!==matching[0].package_profile_sha256.toLowerCase()) throw new Error('Canonical profile hash mismatch');
  const result=await request('qa_package_results',{winget_id:'eq.SadeghHayeri.GreenTunnel',tested_version:'eq.3.0.5',architecture:'eq.x86',installer_sha256:`eq.${hash}`,package_profile_sha256:`eq.${matching[0].package_profile_sha256}`,packager_commit:`eq.${pin}`,outcome:'eq.Passed',select:'phase_results,environment,virustotal_status,virustotal_malicious,virustotal_suspicious'});
  const r=result[0], phases=r?.phase_results;
  if(result.length!==1 || r.environment?.executionContext!=='LocalSystem' || phases?.install?.exitCode!==0 || phases?.detectionAfterInstall?.exitCode!==0 || phases?.uninstall?.exitCode!==0 || phases?.detectionAfterUninstall?.exitCode!==1) throw new Error('Strict mechanical lifecycle evidence required');
  const resolution='strict-pass';
  if(r.virustotal_malicious!==0 || r.virustotal_suspicious!==0) throw new Error('Strict clean reputation evidence required; remain paused');
  await pausedIdle();
  const updated=await request('qa_pipeline_control',{id:'eq.global',paused:'eq.true',required_packager_commit:`eq.${pin}`,scheduler_packager_commit:`eq.${pin}`,scheduler_seen_at:`gte.${new Date(Date.now()-300000).toISOString()}`},
    {paused:false,reason:null,updated_at:new Date().toISOString(),updated_by:'qa-greentunnel-verified-resolution'});
  if(updated.length!==1) throw new Error('Completion resume guard failed');
  console.log(JSON.stringify({action,candidateId:matching[0].id,resolution,paused:false}));
} else throw new Error('Unknown guarded operation');
