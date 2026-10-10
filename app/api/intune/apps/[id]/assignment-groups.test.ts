import {NextRequest} from 'next/server';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),token:vi.fn(),supabase:vi.fn(),resolve:vi.fn()}));
vi.mock('@/lib/auth-utils',()=>({parseAccessToken:mocks.auth}));
vi.mock('@/lib/intune/graph-client',()=>({getServicePrincipalToken:mocks.token}));
vi.mock('@/lib/supabase',()=>({getServerClientOrNull:mocks.supabase}));
vi.mock('@/lib/msp/tenant-resolution',()=>({resolveTargetTenantId:mocks.resolve}));
import {GET} from './route';
const id='11111111-1111-4111-8111-111111111111';
const assignment={id:'assignment',intent:'required',target:{'@odata.type':'#microsoft.graph.groupAssignmentTarget',groupId:id},settings:null};
const request=(query='',headers:Record<string,string>={})=>new NextRequest('http://localhost/api/intune/apps/app'+query,{headers});
const params={params:Promise.resolve({id:'app'})};
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({userId:'user',tenantId:'self'});mocks.token.mockResolvedValue('same-token');mocks.supabase.mockReturnValue(null);});
afterEach(()=>vi.unstubAllGlobals());
describe('app details assignment labels',()=>{
  it('returns resolved names separately and the original assignments unchanged',async()=>{
    const mock=vi.fn(async(url:string)=>Response.json(url.includes('/groups/')?{id,displayName:'Fixture Group'}:url.endsWith('/assignments')?{value:[assignment]}:{id:'app'}));vi.stubGlobal('fetch',mock);
    const response=await GET(request(),params);expect(response.status).toBe(200);expect(await response.json()).toEqual({app:{id:'app',assignments:[assignment],assignmentGroupNames:{[id]:'Fixture Group'}}});
    expect(mock.mock.calls.filter(([url])=>url.includes('/groups/'))).toHaveLength(1);
  });
  it('reports definitive lookup failures separately and only when present',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('/groups/')?new Response(null,{status:404}):Response.json(url.endsWith('/assignments')?{value:[assignment]}:{id:'app'})));
    expect(await(await GET(request(),params)).json()).toEqual({app:{id:'app',assignments:[assignment],assignmentGroupNames:{},assignmentGroupLookupFailures:{[id]:'not_found'}}});
  });
  it('uses the resolved customer tenant token for every group lookup',async()=>{
    const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:{is_active:true},error:null})};mocks.supabase.mockReturnValue({from:()=>chain});mocks.resolve.mockResolvedValue({tenantId:'customer'});mocks.token.mockResolvedValue('customer-token');
    const mock=vi.fn(async(url:string,options:RequestInit)=>{if(url.includes('/groups/'))expect(options.headers).toEqual({Authorization:'Bearer customer-token'});return Response.json(url.includes('/groups/')?{id,displayName:'Customer Group'}:url.endsWith('/assignments')?{value:[assignment]}:{id:'app'});});vi.stubGlobal('fetch',mock);
    expect((await GET(request('',{'X-MSP-Tenant-Id':'customer'}),params)).status).toBe(200);expect(mocks.token).toHaveBeenCalledWith('customer');
  });
  it('preserves unauthenticated and missing token errors without group lookup',async()=>{
    const mock=vi.fn();vi.stubGlobal('fetch',mock);mocks.auth.mockResolvedValue(null);expect((await GET(request(),params)).status).toBe(401);
    mocks.auth.mockResolvedValue({userId:'user',tenantId:'self'});mocks.token.mockResolvedValue(null);expect((await GET(request(),params)).status).toBe(500);expect(mock).not.toHaveBeenCalled();
  });
  it('preserves missing consent',async()=>{
    const chain={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),single:vi.fn().mockResolvedValue({data:null,error:{code:'missing'}})};mocks.supabase.mockReturnValue({from:()=>chain});mocks.resolve.mockResolvedValue({tenantId:'customer'});vi.stubGlobal('fetch',vi.fn());expect((await GET(request(),params)).status).toBe(403);expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves missing app and assignment read failure behavior',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:404})));expect((await GET(request(),params)).status).toBe(404);
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/assignments')?new Response(null,{status:403}):Response.json({id:'app'})));
    expect(await(await GET(request(),params)).json()).toEqual({app:{id:'app',assignments:[],assignmentGroupNames:{}}});
  });
  it('keeps icon requests free of assignment group lookups',async()=>{
    const mock=vi.fn().mockResolvedValue(Response.json({largeIcon:{value:'icon'}}));vi.stubGlobal('fetch',mock);expect(await(await GET(request('?view=icon'),params)).json()).toEqual({icon:{value:'icon'}});expect(mock).toHaveBeenCalledTimes(1);
  });
});
