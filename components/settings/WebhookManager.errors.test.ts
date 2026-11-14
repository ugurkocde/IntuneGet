// @vitest-environment happy-dom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {WebhookManager} from './WebhookManager';
const auth=vi.hoisted(()=>({token:vi.fn(),initializing:false,account:{homeAccountId:'fixture-home',localAccountId:'fixture-a',tenantId:'fixture-tenant-a'}}));
vi.mock('@/hooks/useMicrosoftAuth',()=>({useMicrosoftAuth:()=>({getAccessToken:auth.token,isInitializing:auth.initializing,account:auth.account})}));
vi.mock('./WebhookFormModal',()=>({WebhookFormModal:({isOpen}:{isOpen:boolean})=>isOpen?createElement('input',{'aria-label':'Webhook draft',defaultValue:''}):null}));
let host:HTMLDivElement,root:Root;
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);auth.initializing=false;auth.account={homeAccountId:'fixture-home',localAccountId:'fixture-a',tenantId:'fixture-tenant-a'};auth.token.mockResolvedValue('fixture-token');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.clearAllMocks();});
const response=(data:object,status=200)=>new Response(JSON.stringify(data),{status});
it.each(['http','network'])('shows a retryable webhook load error for %s failure',async kind=>{
 let failed=true;const fetch=vi.fn(async()=>{if(failed){if(kind==='network')throw Error('fixture network');return response({},500);}return response({webhooks:[]});});vi.stubGlobal('fetch',fetch);
 await act(async()=>root.render(createElement(WebhookManager)));
 expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.textContent).not.toContain('No webhooks configured');
 failed=false;const retry=[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry');expect(retry).toBeDefined();await act(async()=>retry!.click());
 expect(fetch).toHaveBeenCalledTimes(2);expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.textContent).toContain('No webhooks configured');
});
it('keeps the existing setup guidance for a 503',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>response({error:'Webhook storage must be configured.'},503)));await act(async()=>root.render(createElement(WebhookManager)));expect(host.textContent).toContain('Webhook storage must be configured.');expect(host.querySelector('[role="alert"]')).toBeNull();});
it.each(['Delete','Disable'])('keeps the webhook after a failed %s and Retry only reloads',async title=>{
 const webhook={id:'fixture',name:'Fixture hook',url:'https://example.invalid/hook',webhook_type:'custom',is_enabled:true,failure_count:0};
 const fetch=vi.fn(async(_url,options)=>response(options?.method?{}:{webhooks:[webhook]},options?.method?500:200));vi.stubGlobal('fetch',fetch);vi.stubGlobal('confirm',()=>true);
 await act(async()=>root.render(createElement(WebhookManager)));await act(async()=>host.querySelector<HTMLButtonElement>(`button[title="${title}"]`)!.click());
 expect(host.textContent).toContain('Fixture hook');expect(host.querySelector('[role="alert"]')).not.toBeNull();expect(host.querySelector('button[title="Disable"]')).not.toBeNull();
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry')!.click());
 expect(fetch.mock.calls.map(c=>c[1]?.method??'GET')).toEqual(['GET',title==='Delete'?'DELETE':'PUT','GET']);
});
it('loads once when startup finishes instead of getting stuck on a missing token',async()=>{
 auth.initializing=true;auth.token.mockResolvedValue(null);const fetch=vi.fn(async()=>response({webhooks:[]}));vi.stubGlobal('fetch',fetch);
 await act(async()=>root.render(createElement(WebhookManager)));expect(fetch).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).toBeNull();
 auth.initializing=false;auth.token.mockResolvedValue('fixture-token');await act(async()=>root.render(createElement(WebhookManager)));expect(fetch).toHaveBeenCalledTimes(1);
});
const hook={id:'fixture',name:'Fixture hook',url:'https://example.invalid/hook',webhook_type:'custom',is_enabled:true,failure_count:0};
it('keeps a webhook draft mounted while a successful test refreshes the list',async()=>{
 let finish!:(r:Response)=>void,loads=0;vi.stubGlobal('fetch',vi.fn(async url=>String(url).endsWith('/test')?response({success:true}):++loads===1?response({webhooks:[hook]}):new Promise<Response>(resolve=>{finish=resolve;})));
 await act(async()=>root.render(createElement(WebhookManager)));await act(async()=>host.querySelector<HTMLButtonElement>('button[title="Edit"]')!.click());const draft=host.querySelector<HTMLInputElement>('input')!;draft.value='Keep this draft';
 await act(async()=>host.querySelector<HTMLButtonElement>('button[title="Send test"]')!.click());expect(host.querySelector('input')).toBe(draft);
 await act(async()=>finish(response({webhooks:[hook]})));expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('Keep this draft');
});
it('ignores a stale webhook load after the auth callback changes',async()=>{
 let old!:(r:Response)=>void;let calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?new Promise<Response>(resolve=>{old=resolve;}):response({webhooks:[{...hook,name:'Current hook'}]})));
 await act(async()=>root.render(createElement(WebhookManager)));auth.token=vi.fn().mockResolvedValue('new-fixture-token');await act(async()=>root.render(createElement(WebhookManager)));
 await act(async()=>old(response({webhooks:[{...hook,name:'Old hook'}]})));expect(host.textContent).toContain('Current hook');expect(host.textContent).not.toContain('Old hook');
});
const switchAccount=()=>{auth.account={...auth.account,localAccountId:'fixture-b',tenantId:'fixture-tenant-b'};auth.token=vi.fn().mockResolvedValue('fixture-token-b');};
it.each([false,true])('hides the previous account rows while the new lookup is pending and after failure (%s)',async fail=>{
 let finish!:(r:Response)=>void,calls=0;vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?response({webhooks:[{...hook,name:'Account A hook'}]}):new Promise<Response>(resolve=>{finish=resolve;})));
 await act(async()=>root.render(createElement(WebhookManager)));expect(host.textContent).toContain('Account A hook');switchAccount();await act(async()=>root.render(createElement(WebhookManager)));expect(host.textContent).not.toContain('Account A hook');
 await act(async()=>finish(response(fail?{}:{webhooks:[{...hook,name:'Account B hook'}]},fail?500:200)));expect(host.textContent).not.toContain('Account A hook');if(fail)expect(host.querySelector('[role="alert"]')).not.toBeNull();else expect(host.textContent).toContain('Account B hook');
});
it('does not start an old account reload when its webhook test finishes after switching',async()=>{
 let test!:(r:Response)=>void,next!:(r:Response)=>void,loads=0;const fetch=vi.fn(async url=>String(url).endsWith('/test')?new Promise<Response>(resolve=>{test=resolve;}):++loads===1?response({webhooks:[hook]}):new Promise<Response>(resolve=>{next=resolve;}));vi.stubGlobal('fetch',fetch);
 await act(async()=>root.render(createElement(WebhookManager)));await act(async()=>host.querySelector<HTMLButtonElement>('button[title="Send test"]')!.click());switchAccount();await act(async()=>root.render(createElement(WebhookManager)));
 await act(async()=>test(response({success:true})));expect(fetch).toHaveBeenCalledTimes(3);await act(async()=>next(response({webhooks:[{...hook,name:'Account B hook'}]})));expect(host.textContent).toContain('Account B hook');
});
