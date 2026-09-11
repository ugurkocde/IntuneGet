// Guarded operational rollout for the reviewed Acrobat repair; no installer access.
const [action, pin] = process.argv.slice(2);
const oldPin = '6bdefc387d1402c71d30a6fbfcf850038f60f37a';
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
const control = await pausedIdle();
if (action==='set-pin') {
  if (control.required_packager_commit!==oldPin) throw new Error('Unexpected prior pin');
  const updated=await request('qa_pipeline_control',{id:'eq.global',paused:'eq.true',required_packager_commit:`eq.${oldPin}`},
    {required_packager_commit:pin,updated_at:new Date().toISOString(),updated_by:'qa-acrobat-reviewed-rollout'});
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
  const candidates=await request('qa_candidates',{winget_id:'eq.Adobe.Acrobat.Pro',version:'eq.26.002.21901',architecture:'eq.x64',status:'eq.queued',installer_sha256:'eq.ECE5D3816C32DE1374B1D228B04D01ABB1621A7AEA6D61728D97A65718053035',select:'id,priority,test_config'});
  const matches=candidates.filter(c=>{
    const p=JSON.parse(c.test_config?.packageProfileCanonicalJson||'{}');
    return p.toolchain?.packagerCommit===pin && p.installer?.uninstallCommand==='REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FFFF-7760-BC15014EA700}:Adobe Acrobat Pro';
  });
  if(matches.length!==1) throw new Error('Exact repaired Acrobat candidate required');
  const candidate=matches[0];
  if(action==='prioritize-retry') {
    const updated=await request('qa_candidates',{id:`eq.${candidate.id}`,status:'eq.queued',dispatched_at:'is.null'},{priority:2000,updated_at:new Date().toISOString()});
    if(updated.length!==1) throw new Error('Retry priority guard failed');
    console.log(JSON.stringify({action,candidateId:candidate.id,priority:2000}));
  } else {
    const queue=await request('qa_candidates',{status:'eq.queued',select:'id',order:'priority.desc,enqueued_at.asc',limit:'1'});
    if(queue[0]?.id!==candidate.id) throw new Error('Exact retry must be first');
    const updated=await request('qa_pipeline_control',{id:'eq.global',paused:'eq.true',required_packager_commit:`eq.${pin}`,scheduler_packager_commit:`eq.${pin}`,scheduler_seen_at:`gte.${new Date(Date.now()-300000).toISOString()}`},
      {paused:false,reason:null,updated_at:new Date().toISOString(),updated_by:'qa-acrobat-exact-retry'});
    if(updated.length!==1) throw new Error('Resume guard failed');
    console.log(JSON.stringify({action,candidateId:candidate.id,requiredPin:pin}));
  }
} else throw new Error('Unknown guarded operation');
