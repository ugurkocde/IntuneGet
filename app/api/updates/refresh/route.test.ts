import {NextRequest} from 'next/server';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),client:vi.fn(),tenant:vi.fn(),live:vi.fn(),notify:vi.fn(),after:vi.fn()}));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:mocks.after}));
vi.mock('@/lib/auth-utils',()=>({parseAccessToken:mocks.user}));
vi.mock('@/lib/supabase',()=>({createServerClient:mocks.client,isSupabaseServerConfigured:()=>true}));
vi.mock('@/lib/db',()=>({isSqliteMode:()=>false,getDatabase:vi.fn()}));
vi.mock('@/lib/msp/tenant-resolution',()=>({resolveTargetTenantId:mocks.tenant}));
vi.mock('@/app/api/intune/apps/updates/route',()=>({GET:mocks.live}));
vi.mock('@/lib/notifications/notify-user',()=>({notifyUserOfPendingUpdates:mocks.notify}));
import {POST,maxDuration} from './route';
const request=()=>new NextRequest('https://example.test/api/updates/refresh',{method:'POST',headers:{Authorization:'Bearer test'},body:'{}'});
describe('hosted update refresh',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.user.mockResolvedValue({userId:'user',tenantId:'tenant'});mocks.tenant.mockResolvedValue({tenantId:'tenant'});});
  it('retains cached results when the bounded live scan is incomplete',async()=>{
    const client={from:vi.fn()};mocks.client.mockReturnValue(client);
    mocks.live.mockResolvedValue(Response.json({code:'UPDATE_SCAN_RETRYABLE'},{status:503}));
    const response=await POST(request());
    expect(maxDuration).toBe(60);expect(response.status).toBe(503);expect(client.from).not.toHaveBeenCalled();expect(mocks.after).not.toHaveBeenCalled();
  });
  it('persists a complete scan and schedules notification after responding',async()=>{
    const writes:unknown[]=[];
    mocks.client.mockReturnValue({from:()=>{const chain:Record<string,unknown>={};chain.select=()=>chain;chain.eq=()=>chain;chain.upsert=(values:unknown)=>{writes.push(values);return Promise.resolve({error:null});};chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{id:'old',winget_id:'Example.App',intune_app_id:'app',latest_version:'1',notified_at:null}],error:null}).then(resolve);return chain;}});
    mocks.live.mockResolvedValue(Response.json({updates:[{wingetId:'Example.App',intuneApp:{id:'app',displayName:'Example'},currentVersion:'1',latestVersion:'2',isManaged:true}],updateCount:1,checkedApps:[]}));
    const response=await POST(request());
    expect(response.status).toBe(200);expect(writes).toHaveLength(1);expect(mocks.notify).not.toHaveBeenCalled();expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();expect(mocks.notify).toHaveBeenCalledOnce();
  });
});

