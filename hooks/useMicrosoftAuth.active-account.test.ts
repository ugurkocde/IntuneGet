// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => { const values = new Map<string,string>(); Object.defineProperty(globalThis,'localStorage',{ configurable:true,value:{ getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k) } }); });
const f=vi.hoisted(() => ({ activeIndex:1,accounts:[{homeAccountId:'home-a',localAccountId:'user-a',tenantId:'tenant-a',username:'a@example.test',name:'A'},{homeAccountId:'home-b',localAccountId:'user-b',tenantId:'tenant-b',username:'b@example.test',name:'B'}], silent:vi.fn(), logout:vi.fn(), consent:vi.fn((tenant:string)=>'https://example.test/consent/'+tenant) }));
vi.mock('@azure/msal-react',()=>{const instance={getActiveAccount:()=>f.accounts[f.activeIndex],acquireTokenSilent:f.silent,logoutRedirect:f.logout};return{useMsal:()=>({instance,accounts:f.accounts,inProgress:'none'}),useIsAuthenticated:()=>true};});
vi.mock('@/lib/msal-config',()=>({graphScopes:['fixture.read'],getAdminConsentUrl:f.consent}));
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useCartStore } from '@/stores/cart-store';
let root:Root, auth:ReturnType<typeof useMicrosoftAuth>;
function Probe(){const value=useMicrosoftAuth();useLayoutEffect(()=>{auth=value;});return null;}
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(async()=>{f.activeIndex=1;f.silent.mockResolvedValue({accessToken:'fixture-token',expiresOn:new Date(Date.now()+3600000)});f.logout.mockReset();const div=document.createElement('div');document.body.append(div);root=createRoot(div);await act(async()=>root.render(createElement(Probe)));});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';vi.clearAllMocks();});
it('uses the active account for the visible user, token and consent tenant',async()=>{await auth.getAccessToken();expect(f.silent.mock.calls[0][0].account).toBe(f.accounts[1]);expect(auth.account).toBe(f.accounts[1]);expect(auth.user?.id).toBe('user-b');auth.getShareableConsentUrl();expect(f.consent).toHaveBeenLastCalledWith('tenant-b');});
it('clears persisted cart items before redirecting on sign out',async()=>{useCartStore.setState({items:[{id:'private-item',assignments:[{groupName:'Private group'}]}],scope:'home-b|tenant-b',activeScope:'home-b|tenant-b'} as never);f.logout.mockImplementation(async()=>{expect(useCartStore.getState().items).toHaveLength(0);const saved=JSON.parse(localStorage.getItem('intuneget-cart')!);expect(saved.state.items).toHaveLength(0);});await act(async()=>{expect(await auth.signOut()).toBe(true);});expect(f.logout).toHaveBeenCalledOnce();});

it('keeps tokens and display aligned when the active account changes without changing the cache',async()=>{await auth.getAccessToken();f.activeIndex=0;await act(async()=>root.render(createElement(Probe)));await auth.getAccessToken();expect(auth.account).toBe(f.accounts[0]);expect(auth.user?.id).toBe('user-a');expect(f.silent.mock.lastCall?.[0].account).toBe(f.accounts[0]);f.activeIndex=-1;await act(async()=>root.render(createElement(Probe)));expect(auth.account).toBe(f.accounts[0]);});
