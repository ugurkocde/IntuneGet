// Apply the existing shared reputation gate to the exact unavailable retry.
const base=process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const pin='7238616608f888449fa2e132fffc8d7314c26745';
const hash='ECE5D3816C32DE1374B1D228B04D01ABB1621A7AEA6D61728D97A65718053035';
const tuple={winget_id:'Adobe.Acrobat.Pro',version:'26.002.21901',architecture:'x64',installer_sha256:hash};
if(!base||new URL(base).hostname!=='mbhajocqtogfbgojkwhd.supabase.co'||!key) throw new Error('Production environment required');
async function request(table,params,method='GET',body,prefer='return=representation') {
  const r=await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(params)}`,{
    method,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:prefer},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),
  });
  if(!r.ok) throw new Error(`${table} HTTP ${r.status}`);
  return r.json();
}
async function guard() {
  const [controls,active]=await Promise.all([
    request('qa_pipeline_control',{id:'eq.global',select:'paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at'}),
    request('qa_candidates',{status:'in.(dispatched,running)',select:'id'}),
  ]);
  const c=controls[0];
  if(controls.length!==1||!c.paused||active.length||c.required_packager_commit!==pin||c.scheduler_packager_commit!==pin||Date.now()-Date.parse(c.scheduler_seen_at)>300000) throw new Error('Paused, idle, fresh aligned production required');
}
await guard();
const [candidates,reputation,reconciliation]=await Promise.all([
  request('qa_candidates',{id:'eq.f8d5e099-cf31-4cc7-a454-8235f838441d',...Object.fromEntries(Object.entries(tuple).map(([k,v])=>[k,`eq.${v}`])),status:'eq.failed',select:'id'}),
  request('catalog_file_reputation',{sha256:`eq.${hash.toLowerCase()}`,select:'status,malicious,suspicious'}),
  request('qa_catalog_reconciliations',{winget_id:'eq.Adobe.Acrobat.Pro',catalog_version:'eq.26.002.21901',reason_code:'eq.installer_manifest_missing',select:'reason_code,updated_at'}),
]);
if(candidates.length!==1||reputation.length!==1||reputation[0].status!=='not_found'||reputation[0].malicious!==null||reputation[0].suspicious!==null||!reconciliation.length) throw new Error('Exact failed tuple, absent file report and unavailable retry evidence required');
await request('qa_package_blocks',{on_conflict:'winget_id,version,architecture,installer_sha256'},'POST',{
  ...tuple,block_code:'unverified_file_reputation',
  detail:'The exact installer has no VirusTotal file report. Automated deployment is blocked until its file reputation can be verified.',
  observed_at:new Date().toISOString(),updated_at:new Date().toISOString(),
},'resolution=ignore-duplicates,return=representation');
const blocks=await request('qa_package_blocks',Object.fromEntries(Object.entries(tuple).map(([k,v])=>[k,`eq.${v}`])));
if(blocks.length!==1||blocks[0].block_code!=='unverified_file_reputation') throw new Error('Shared block verification failed');
await guard();
const updated=await request('qa_pipeline_control',{
  id:'eq.global',paused:'eq.true',required_packager_commit:`eq.${pin}`,scheduler_packager_commit:`eq.${pin}`,scheduler_seen_at:`gte.${new Date(Date.now()-300000).toISOString()}`,
},'PATCH',{paused:false,reason:null,updated_at:new Date().toISOString(),updated_by:'qa-acrobat-shared-reputation-block'});
if(updated.length!==1) throw new Error('Guarded resume did not match');
console.log(JSON.stringify({observedAtUtc:new Date().toISOString(),...tuple,block:'unverified_file_reputation',requiredPin:pin,paused:false,strictPass:false}));
