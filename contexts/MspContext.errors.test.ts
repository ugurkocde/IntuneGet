// @vitest-environment happy-dom
import {act,createElement,useLayoutEffect,type ReactNode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {cachedAccount,createMsalTestDouble} from '@/test-utils/msal-test-double';
const state=vi.hoisted(()=>({client:null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble>,push:vi.fn(),settings:{selectedTenantId:null},save:vi.fn()}));
vi.mock('@azure/msal-react',()=>({useMsal:()=>state.client.context,useIsAuthenticated:()=>state.client.context.accounts.length>0}));
vi.mock('@/lib/msal-config',()=>({graphScopes:['fixture.read'],getAdminConsentUrl:vi.fn()}));
vi.mock('@/components/providers/UserSettingsProvider',()=>({useUserSettings:()=>({settings:state.settings,setSelectedTenantId:state.save})}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:state.push})}));
vi.mock('next/link',()=>({default:({children}:{children:ReactNode})=>children}));
vi.mock('gt-next',()=>({T:({children}:{children:ReactNode})=>children}));
vi.mock('framer-motion',()=>({useReducedMotion:()=>false,motion:{div:({children}:{children:ReactNode})=>createElement('div',null,children)}}));
vi.mock('@/components/msp',()=>({MspStatsOverview:()=>null,CrossTenantJobsTable:()=>null,TenantCard:()=>null}));
vi.mock('@/components/dashboard',()=>({PageHeader:()=>null,SkeletonGrid:()=>null}));
import {MspProvider,useMsp} from './MspContext';
import Dashboard from '@/app/(app)/dashboard/msp/page';
import MspLayout from '@/app/(app)/dashboard/msp/layout';
let root:Root,host:HTMLDivElement,context:ReturnType<typeof useMsp>;
function Probe(){const v=useMsp();useLayoutEffect(()=>{context=v;});return null;}
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);state.client=createMsalTestDouble();host=document.createElement('div');document.body.append(host);root=createRoot(host);state.push.mockClear();});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
const render=(child:ReactNode)=>act(async()=>root.render(createElement(MspProvider,null,child)));
const response=(v:object,status=200)=>new Response(JSON.stringify(v),{status});
it('keeps a cached account pending while MSAL initializes instead of redirecting to setup',async()=>{
 state.client.context.accounts=[cachedAccount];const fetch=vi.fn(async()=>response({organization:null,stats:null,isMspUser:false}));vi.stubGlobal('fetch',fetch);
 await render(createElement(Dashboard));expect(fetch).not.toHaveBeenCalled();expect(state.push).not.toHaveBeenCalled();expect(state.client.instance.getActiveAccount).not.toHaveBeenCalled();
 const init=state.client.instance.initialize();state.client.finishInitialization();await init;await render(createElement(Dashboard));expect(fetch).toHaveBeenCalledTimes(1);
});
it('exposes a failed organization lookup separately from a successful no organization answer',async()=>{
 const init=state.client.instance.initialize();state.client.finishInitialization();await init;let failed=true;vi.stubGlobal('fetch',vi.fn(async()=>response(failed?{}:{organization:null,stats:null,isMspUser:false},failed?500:200)));
 await render(createElement(Probe));expect(context.organizationError).toBeTruthy();expect(context.hasResolvedOrganization).toBe(false);
 failed=false;await act(async()=>context.refreshOrganization());expect(context.organizationError).toBeNull();expect(context.hasResolvedOrganization).toBe(true);
});
const ready = async()=>{const init=state.client.instance.initialize();state.client.finishInitialization();await init;};
const noOrganization={organization:null,stats:null,isMspUser:false};
it('blocks MSP children and setup redirects on failure and mounts them after Retry',async()=>{
 await ready();let failed=true;vi.stubGlobal('fetch',vi.fn(async()=>response(failed?{}:noOrganization,failed?500:200)));
 await render(createElement(MspLayout,null,createElement(Dashboard)));
 expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(state.push).not.toHaveBeenCalled();
 failed=false;await act(async()=>host.querySelector('button')!.click());
 expect(host.querySelector('[role="alert"]')).toBeNull();expect(state.push).toHaveBeenCalledWith('/dashboard/msp/setup');
});
it('keeps resolved setup children mounted during organization creation refresh',async()=>{
 await ready();let finish!: (r:Response)=>void;let loads=0;let mounts=0;
 function Child(){useLayoutEffect(()=>{mounts++;},[]);return createElement('span',null,'Setup form');}
 vi.stubGlobal('fetch',vi.fn(async(_url,options)=>options?.method==='POST'?response({organization:{id:'fixture-org'}}):++loads===1?response(noOrganization):new Promise<Response>(resolve=>{finish=resolve;})));
 await render(createElement('div',null,createElement(Probe),createElement(MspLayout,null,createElement(Child))));
 let creation!:Promise<unknown>;await act(async()=>{creation=context.createOrganization({name:'Fixture organization'});});
 expect(host.textContent).toContain('Setup form');expect(mounts).toBe(1);
 await act(async()=>{finish(response(noOrganization));await creation;});expect(mounts).toBe(1);
});
it.each([false,true])('ignores an older response when a newer lookup finishes first (older success %s)',async olderSuccess=>{
 await ready();let old!: (r:Response)=>void;let calls=0;
 vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?response(noOrganization):calls===2?new Promise<Response>(resolve=>{old=resolve;}):response(olderSuccess?{}:noOrganization,olderSuccess?500:200)));
 await render(createElement(Probe));let pending!:Promise<void>;
 await act(async()=>{pending=context.refreshOrganization();});await act(async()=>context.refreshOrganization());
 const latestError=context.organizationError;await act(async()=>{old(response(olderSuccess?noOrganization:{},olderSuccess?200:500));await pending;});
 expect(context.organizationError).toBe(latestError);expect(Boolean(latestError)).toBe(olderSuccess);
});
it('retains a resolved organization on a failed refresh for the same account',async()=>{
 await ready();let failed=false;vi.stubGlobal('fetch',vi.fn(async url=>String(url).endsWith('/tenants')?response({tenants:[]}):response(failed?{}:{organization:{id:'fixture-org'},stats:null,isMspUser:true,current_user:{access_mode:'read_only'}},failed?500:200)));
 await render(createElement(Probe));failed=true;await act(async()=>context.refreshOrganization());
 expect(context.organization?.id).toBe('fixture-org');expect(context.isMspUser).toBe(true);expect(context.accessMode).toBe('read_only');expect(context.organizationError).toBeTruthy();
});
it('shows an organization error for a missing token after startup',async()=>{
 await ready();state.client.instance.acquireTokenSilent.mockResolvedValue({accessToken:'',expiresOn:new Date(Date.now()+3600000)});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 await render(createElement(Probe));expect(fetch).not.toHaveBeenCalled();expect(context.organizationError).toBeTruthy();expect(context.hasResolvedOrganization).toBe(false);
});
const switchProfile=()=>{const account={...cachedAccount,localAccountId:'user-b',tenantId:'tenant-b'};state.client.instance.setActiveAccount(account);state.client.context.accounts=[account];};
it('clears organization state when tenant profiles share the home account',async()=>{
 await ready();let failed=false;vi.stubGlobal('fetch',vi.fn(async url=>String(url).endsWith('/tenants')?response({tenants:[]}):response(failed?{}:{organization:{id:'old-org'},stats:null,isMspUser:true},failed?500:200)));
 await render(createElement(Probe));failed=true;switchProfile();await render(createElement(Probe));
 expect(context.organization).toBeNull();expect(context.isMspUser).toBe(false);expect(context.hasResolvedOrganization).toBe(false);expect(context.organizationError).toBeTruthy();
});
it('does not let an old create completion invalidate the new account lookup',async()=>{
 await ready();let post!:(r:Response)=>void,newLookup!:(r:Response)=>void;let calls=0;
 const fetch=vi.fn(async(_url,options)=>options?.method==='POST'?new Promise<Response>(resolve=>{post=resolve;}):++calls===1?response(noOrganization):new Promise<Response>(resolve=>{newLookup=resolve;}));vi.stubGlobal('fetch',fetch);
 await render(createElement(Probe));let creation!:Promise<unknown>;await act(async()=>{creation=context.createOrganization({name:'Fixture'});});switchProfile();await render(createElement(Probe));
 await act(async()=>{post(response({organization:{id:'old-created'}}));await Promise.resolve();await Promise.resolve();});
 expect(fetch).toHaveBeenCalledTimes(3);await act(async()=>{newLookup(response(noOrganization));await creation;});expect(context.hasResolvedOrganization).toBe(true);
});
