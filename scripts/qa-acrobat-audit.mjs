// Read-only, bounded operational evidence. Run through the linked production environment.
const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (new URL(base).hostname !== 'mbhajocqtogfbgojkwhd.supabase.co' || !key) throw new Error('Production environment required');
async function rows(table, params) {
  const response = await fetch(`${base}/rest/v1/${table}?${new URLSearchParams(params)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Read failed: ${table} ${response.status}`);
  return response.json();
}
const candidates = await rows('qa_candidates', {
  winget_id: 'eq.Adobe.Acrobat.Pro', order: 'enqueued_at.desc', limit: '2',
  select: 'id,version,architecture,status,phase,github_run_id,installer_sha256,package_profile_sha256,test_config,live_log',
});
console.log(JSON.stringify(candidates.map(({test_config: config, live_log, ...row}) => {
  const canonical = JSON.parse(config.packageProfileCanonicalJson || '{}');
  return {...row, profile: { toolchain: canonical.toolchain, installer: canonical.installer },
    config: Object.fromEntries(['sourceInstallerType','productCode','uninstallCommand','nestedInstallerType','nestedInstallerFiles'].map(k=>[k,config[k]])),
    liveLog: live_log ? JSON.stringify(live_log).slice(-10000) : null };
}), null, 2));
