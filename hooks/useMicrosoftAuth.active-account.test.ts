// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createMsalTestDouble } from '@/test-utils/msal-test-double';
vi.hoisted(() => { const values = new Map<string,string>(); Object.defineProperty(globalThis,'localStorage',{ configurable:true,value:{ getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k) } }); });
const f=vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble>, activeIndex:1,cloneActive:false,accounts:[{homeAccountId:'home-a',localAccountId:'user-a',tenantId:'tenant-a',environment:'example.test',username:'a@example.test',name:'A'},{homeAccountId:'home-b',localAccountId:'user-b',tenantId:'tenant-b',environment:'example.test',username:'b@example.test',name:'B'}], silent:vi.fn(), logout:vi.fn(), consent:vi.fn((tenant:string)=>'https://example.test/consent/'+tenant) }));
vi.mock('@azure/msal-react',()=>({useMsal:()=>f.client.context,useIsAuthenticated:()=>f.client.context.accounts.length>0}));
vi.mock('@/lib/msal-config',()=>({graphScopes:['fixture.read'],getAdminConsentUrl:f.consent}));
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useCartStore } from '@/stores/cart-store';
let root:Root, auth:ReturnType<typeof useMicrosoftAuth>;
function Probe(){const value=useMicrosoftAuth();useLayoutEffect(()=>{auth=value;});return null;}
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(async()=>{
 f.activeIndex=1;f.cloneActive=false;
 f.client=createMsalTestDouble({cachedAccounts:f.accounts,activeAccount:()=>{const a=f.accounts[f.activeIndex];return a&&f.cloneActive?{...a}:a??null;}});
 const initialization=f.client.instance.initialize();f.client.finishInitialization();await initialization;
 const div=document.createElement('div');document.body.append(div);root=createRoot(div);await act(async()=>root.render(createElement(Probe)));
});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';vi.clearAllMocks();});
it('uses the active account for the visible user, token and consent tenant',async()=>{await auth.getAccessToken();expect(f.client.instance.acquireTokenSilent.mock.calls[0][0].account).toBe(f.accounts[1]);expect(auth.account).toBe(f.accounts[1]);expect(auth.user?.id).toBe('user-b');auth.getShareableConsentUrl();expect(f.consent).toHaveBeenLastCalledWith('tenant-b');});
it('clears persisted cart items before redirecting on sign out',async()=>{useCartStore.setState({items:[{id:'private-item',assignments:[{groupName:'Private group'}]}],scope:'home-b|tenant-b',activeScope:'home-b|tenant-b'} as never);f.client.instance.logoutRedirect.mockImplementation(async()=>{expect(useCartStore.getState().items).toHaveLength(0);const saved=JSON.parse(localStorage.getItem('intuneget-cart')!);expect(saved.state.items).toHaveLength(0);});await act(async()=>{expect(await auth.signOut()).toBe(true);});expect(f.client.instance.logoutRedirect).toHaveBeenCalledOnce();});

it('keeps tokens and display aligned when the active account changes without changing the cache',async()=>{await auth.getAccessToken();f.activeIndex=0;await act(async()=>root.render(createElement(Probe)));await auth.getAccessToken();expect(auth.account).toBe(f.accounts[0]);expect(auth.user?.id).toBe('user-a');expect(f.client.instance.acquireTokenSilent.mock.lastCall?.[0].account).toBe(f.accounts[0]);f.activeIndex=-1;await act(async()=>root.render(createElement(Probe)));expect(auth.account).toBe(f.accounts[0]);});

it('keeps token callbacks stable when MSAL returns fresh objects for the same identity',async()=>{f.cloneActive=true;await act(async()=>root.render(createElement(Probe)));const token=auth.getAccessToken,refresh=auth.refreshToken;await act(async()=>root.render(createElement(Probe)));expect(auth.getAccessToken).toBe(token);expect(auth.refreshToken).toBe(refresh);});
