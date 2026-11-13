// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => { const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}}); });
const f=vi.hoisted(()=>({account:{homeAccountId:'home-a',tenantId:'tenant-a'},initializing:false,orgLoading:false,isMsp:false,tenantsLoading:false,tenant:null as string|null}));
vi.mock('@/hooks/useMicrosoftAuth',()=>({useMicrosoftAuth:()=>({account:f.account,isAuthenticated:true,isInitializing:f.initializing})}));
vi.mock('@/hooks/useMspOptional',()=>({useMspOptional:()=>({isLoadingOrganization:f.orgLoading,isMspUser:f.isMsp,isLoadingTenants:f.tenantsLoading,selectedTenantId:f.tenant})}));
import { useCartStore, selectScopedItems } from '@/stores/cart-store';
import { useCartScopeSync } from './useCartScopeSync';
let root:Root; const item={id:'old-item',displayName:'Private configured app'};
function Probe(){useCartScopeSync();const items=useCartStore(selectScopedItems);return createElement('div',null,items.map(i=>i.displayName).join(','));}
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
beforeEach(()=>{Object.assign(f,{account:{homeAccountId:'home-a',tenantId:'tenant-a'},initializing:false,orgLoading:false,isMsp:false,tenantsLoading:false,tenant:null});useCartStore.setState({items:[item],scope:'home-a|tenant-a',activeScope:null,isOpen:false,autoOpenOnAdd:true} as never);const div=document.createElement('div');document.body.append(div);root=createRoot(div);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
const render=async()=>{await act(async()=>root.render(createElement(Probe)));};
it('clears a never opened cart when the tenant changes',async()=>{await render();expect(document.body.textContent).toContain('Private configured app');f.isMsp=true;f.tenant='customer-b';await render();expect(useCartStore.getState().items).toHaveLength(0);expect(document.body.textContent).not.toContain('Private configured app');expect(useCartStore.getState().isOpen).toBe(false);});
it('clears an account switch within the same tenant',async()=>{await render();f.account={homeAccountId:'home-b',tenantId:'tenant-a'};await render();expect(useCartStore.getState().items).toHaveLength(0);});
it('does not discard the matching persisted cart while MSP context initializes',async()=>{useCartStore.setState({scope:'home-a|customer-b'});f.orgLoading=true;await render();expect(document.body.textContent).not.toContain('Private configured app');expect(useCartStore.getState().items).toHaveLength(1);f.orgLoading=false;f.isMsp=true;f.tenantsLoading=true;await render();expect(useCartStore.getState().items).toHaveLength(1);f.tenant='customer-b';f.tenantsLoading=false;await render();expect(document.body.textContent).toContain('Private configured app');});
it('keeps a version two cart on a same scope reload',async()=>{localStorage.setItem('intuneget-cart',JSON.stringify({version:2,state:{items:[item],scope:'home-a|tenant-a',autoOpenOnAdd:false}}));useCartStore.setState({items:[],scope:null,activeScope:null});localStorage.setItem('intuneget-cart',JSON.stringify({version:2,state:{items:[item],scope:'home-a|tenant-a',autoOpenOnAdd:false}}));await useCartStore.persist.rehydrate();await render();expect(useCartStore.getState().items).toHaveLength(1);expect(useCartStore.getState().autoOpenOnAdd).toBe(false);});
it('drops legacy unscoped items and preserves the cart preference',async()=>{localStorage.setItem('intuneget-cart',JSON.stringify({version:1,state:{items:[item],autoOpenOnAdd:false}}));await useCartStore.persist.rehydrate();await render();expect(document.body.textContent).not.toContain('Private configured app');expect(useCartStore.getState().items).toHaveLength(0);expect(useCartStore.getState().autoOpenOnAdd).toBe(false);});
it('ignores a late edit after the original cart was cleared',async()=>{await render();f.tenant='customer-b';f.isMsp=true;await render();await act(async()=>useCartStore.getState().updateItem('old-item',{displayName:'Late private edit'}));expect(useCartStore.getState().items).toHaveLength(0);});
