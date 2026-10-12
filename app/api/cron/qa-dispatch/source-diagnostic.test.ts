import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { client, diagnostic, dispatch } = vi.hoisted(() => ({ client: vi.fn(), diagnostic: vi.fn(), dispatch: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerClient: client }));
vi.mock('@/lib/installer-preflight', async original => ({ ...await original<typeof import('@/lib/installer-preflight')>(), diagnoseInstallerSource: diagnostic }));
vi.mock('@/lib/qa/dispatch', () => ({ dispatchQaCandidate: dispatch }));
import { POST } from './route';
const id='00000000-0000-4000-8000-000000000001';
describe('source-only POST cannot fall through to recovery', () => {
  const write = vi.fn(); let row: Record<string, unknown> | null;
  beforeEach(() => {
    vi.clearAllMocks();vi.stubEnv('CRON_SECRET','fixture');
    row={ winget_id:'Example.App', version:'1.0', architecture:'x64', installer_url:'https://source.test/setup', installer_sha256:'A'.repeat(64),installer_type:'msi',test_config:{},test_level:'psadt-package',status:'error' };
    const builder={select:vi.fn(()=>builder),eq:vi.fn(()=>builder),in:vi.fn(()=>builder),or:vi.fn(()=>builder),maybeSingle:vi.fn(async()=>({data:row,error:null})),update:write,insert:write,upsert:write,delete:write}; write.mockImplementation(()=>builder);
    client.mockReturnValue({from:vi.fn(()=>builder),rpc:write});diagnostic.mockResolvedValue({probed:true,diagnostic:{outcome:'reachable',hops:[]}});
  });
  afterEach(()=>vi.unstubAllEnvs());
  const request=(body:unknown,auth='Bearer fixture')=>new Request('https://app.test/api/cron/qa-dispatch',{method:'POST',headers:{authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(body)});
  it('returns the probe without a claim, dispatch or any database mutation',async()=>{
    const response=await POST(request({mode:'source-diagnostic',candidateId:id}));expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({mode:'source-diagnostic',probed:true});expect(write).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(diagnostic).toHaveBeenCalledOnce();
  });
  it('does not authenticate an arbitrary caller',async()=>{expect((await POST(request({mode:'source-diagnostic',candidateId:id},'Bearer wrong'))).status).toBe(401);expect(client).not.toHaveBeenCalled();});
  it('rejects unknown modes before recovery writes',async()=>{expect((await POST(request({mode:'typo',candidateId:id}))).status).toBe(400);expect(write).not.toHaveBeenCalled();});
  it('does not recover a missing diagnostic candidate',async()=>{row=null;expect((await POST(request({mode:'source-diagnostic',candidateId:id}))).status).toBe(404);expect(write).not.toHaveBeenCalled();});
});
