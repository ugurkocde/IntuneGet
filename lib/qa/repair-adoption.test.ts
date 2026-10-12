import { beforeEach, expect, it, vi } from 'vitest';
import { adoptRepairCurrentCandidate } from './repair-adoption';
import { WingetDependencyCompatibilityError } from '@/lib/winget-dependencies';

const dependencies = vi.hoisted(() => vi.fn());
vi.mock('@/lib/winget-dependencies', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/winget-dependencies')>(),
  resolveWingetPackageDependencies: dependencies,
}));
const hash = 'A'.repeat(64), repairId = '22222222-2222-4222-8222-222222222222';
function fixture(change: Record<string, unknown> = {}, outcome = 'inserted') {
  const old = { id:'old',winget_id:'Example.App',version:'1',architecture:'x64',installer_sha256:hash,installer_url:'https://example.test/setup.exe',test_config:{scope:'machine'} };
  const repair = { id:repairId,candidate_id:'old',winget_id:'Example.App',version:'1',architecture:'x64',status:'in_progress',failure_class:'app_lifecycle',prior_requeues:2 };
  const from = vi.fn((table: string) => {
    const rows: Record<string, unknown> = { qa_repair_requests:repair,qa_candidates:old,curated_apps:{winget_id:'Example.App',name:'Example',publisher:'Example',latest_version:'2'},qa_recipes:null };
    const q: Record<string, unknown> = {};
    for(const method of ['select','eq']) q[method]=vi.fn(()=>q);
    q.maybeSingle=vi.fn(async()=>({data:rows[table]??null,error:null}));
    return q;
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if(name==='insert_qa_candidate_if_absent') return {data:{outcome,candidate:{...args.p_candidate as object,id:'new'}},error:null};
    if(name==='adopt_qa_repair_current_candidate') return {data:'new',error:null};
    throw Error('Unexpected RPC');
  });
  const manifest={PackageIdentifier:'Example.App',PackageVersion:'1',InstallerType:'nullsoft',Installers:[{Architecture:'x64',InstallerSha256:hash,InstallerUrl:old.installer_url,Scope:'machine',InstallerSwitches:{Silent:'/S'},...change}]};
  const client={fetchInstallerManifest:vi.fn(async()=>manifest),fetchVersions:vi.fn(async()=>['2','1'])};
  return {db:{from,rpc} as never,client,rpc,from};
}
beforeEach(()=>{dependencies.mockReset();dependencies.mockResolvedValue([]);});
it('fetches the old version even when live is newer and prepares no executable queue slot',async()=>{
  const f=fixture();expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({outcome:'adopted',candidateId:'new'});
  expect(f.client.fetchInstallerManifest).toHaveBeenCalledWith('Example.App','1');expect(f.client.fetchVersions).not.toHaveBeenCalled();
  const row=f.rpc.mock.calls[0][1].p_candidate as Record<string,unknown>;
  expect(row).toMatchObject({status:'superseded',test_level:'psadt-package',demand_source:'operator',failure_summary:'Awaiting diagnostic retest grant'});
  expect(row.finished_at).toEqual(expect.any(String));expect(f.rpc.mock.calls[1]).toEqual(['adopt_qa_repair_current_candidate',{p_repair_id:repairId,p_candidate_id:'new'}]);
});
it.each([{InstallerSha256:'B'.repeat(64)},{InstallerUrl:'https://example.test/new.exe'},{Scope:'user'}])('does not insert a changed installer or scope %j',async change=>{
  const f=fixture(change);expect((await adoptRepairCurrentCandidate(f.db,f.client,repairId)).outcome).toBe('denied');expect(f.rpc).not.toHaveBeenCalled();
});
it('does not fall back to live when the exact version is absent',async()=>{
  const f=fixture();f.client.fetchInstallerManifest.mockResolvedValue(null as never);
  expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'version_missing'});expect(f.rpc).not.toHaveBeenCalled();expect(f.client.fetchVersions).not.toHaveBeenCalled();
});
it('dependency errors never overwrite the existing failure quarantine',async()=>{
  const f=fixture();dependencies.mockRejectedValue(new WingetDependencyCompatibilityError('No compatible dependency','unreviewed_dependency'));
  expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'dependency_incompatible'});expect(f.rpc).not.toHaveBeenCalled();
  expect(f.from.mock.calls.map(([table])=>table)).not.toContain('qa_package_blocks');
});
it('denies an active insert conflict',async()=>{
  const f=fixture({},'active_conflict');expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'active_conflict'});expect(f.rpc).toHaveBeenCalledTimes(1);
});
