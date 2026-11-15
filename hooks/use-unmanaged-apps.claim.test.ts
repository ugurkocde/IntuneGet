// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ token: vi.fn(), claim: vi.fn() }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ isAuthenticated: false, getAccessToken: f.token }) }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: false, selectedTenantId: null }) }));
vi.mock('@/components/providers/UserSettingsProvider', () => ({ useUserSettings: () => ({ settings: { viewMode: 'grid' }, setViewMode: vi.fn() }) }));
vi.mock('@/lib/detection-rules', () => ({ generateDetectionRules: () => [], generateInstallCommand: () => 'install', generateUninstallCommand: () => 'uninstall' }));
vi.mock('@/lib/requirement-rules', () => ({ buildCartItemRequirementRules: () => [] }));
import { useUnmanagedApps } from './use-unmanaged-apps';
import { useCartStore } from '@/stores/cart-store';
import type { UnmanagedApp } from '@/types/unmanaged';
let api: ReturnType<typeof useUnmanagedApps>, root: Root;
const app = { id:'fixture', discoveredAppId:'fixture', displayName:'Example App', version:'1', matchedPackageId:'Example.App', matchStatus:'matched' } as UnmanagedApp;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Fixture() { const value = useUnmanagedApps(); useLayoutEffect(() => { api = value; }); return null; }
beforeEach(async () => {
 f.token.mockReset().mockResolvedValue('fixture-token'); f.claim.mockReset();
 useCartStore.setState({ items: [], scope:'fixture', activeScope:'fixture' });
 vi.spyOn(console, 'error').mockImplementation(() => {});
 vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/intune/claim' ? f.claim() : Response.json({ recommendedInstaller:{ architecture:'x64',type:'msi',url:'https://example.test/app.msi',sha256:'a'.repeat(64) },manifest:{name:'Example App',version:'1'} })));
 const node=document.createElement('div');document.body.append(node);root=createRoot(node);
 await act(async () => root.render(createElement(Fixture)));
});
afterEach(async () => { await act(async()=>root.unmount()); document.body.innerHTML=''; vi.unstubAllGlobals();vi.restoreAllMocks(); });
it('keeps one cart item after a failed claim and a successful retry', async()=>{
 f.claim.mockResolvedValueOnce(Response.json({error:'temporary'},{status:503})).mockResolvedValueOnce(Response.json({success:true}));
 await act(async()=>{await expect(api.handleClaimApp(app)).rejects.toThrow();});
 expect(useCartStore.getState().items).toHaveLength(1);
 await act(async()=>api.handleClaimApp(app));
 expect(useCartStore.getState().items).toHaveLength(1);
});
it('does not duplicate a cart entry when the same successful claim is retried',async()=>{
 f.claim.mockImplementation(()=>Response.json({success:true}));
 await act(async()=>api.handleClaimApp(app));await act(async()=>api.handleClaimApp(app));
 expect(useCartStore.getState().items).toHaveLength(1);
});

it('does not duplicate cart entries when Claim All retries a failed app',async()=>{
 f.claim.mockResolvedValueOnce(Response.json({error:'temporary'},{status:503})).mockResolvedValueOnce(Response.json({success:true}));
 await act(async()=>api.setClaimAllModal({ apps:[app], results:new Map([['fixture','pending']]), isComplete:false } as never));
 await act(async()=>api.processClaimAll([app]));
 expect(api.claimAllModal?.results.get('fixture')).toBe('failed');
 await act(async()=>api.retryFailedClaims());
 expect(useCartStore.getState().items).toHaveLength(1);
 expect(api.claimAllModal?.results.get('fixture')).toBe('success');
});

it.each(['pending', 'failed'])('keeps server %s claims with an empty cart after reload', async (claimStatus) => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ apps: [{ ...app, isClaimed: true, claimStatus }], total: 1 })));
 await act(async () => api.handleRefresh());
 expect(api.filteredApps[0]).toMatchObject({ isClaimed: true, claimStatus });
 expect(api.filteredApps[0].inCart).toBe(false);
 expect(api.computedStats.claimed).toBe(1);
 expect(api.claimableCount).toBe(0);
 await act(async () => api.setFilters({ ...api.filters, showClaimed: false }));
 expect(api.filteredApps).toHaveLength(0);
});

it('recovers a saved pending claim and keeps cart membership separate from saved state', async () => {
 const manifestFetch = globalThis.fetch;
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
   url.startsWith('/api/intune/unmanaged-apps')
     ? Response.json({ apps: [{ ...app, isClaimed: true, claimStatus: 'pending' }], total: 1 })
     : manifestFetch(url, init)));
 f.claim.mockImplementation(() => Response.json({ success: true }));
 await act(async () => api.handleRefresh());
 const saved = api.filteredApps[0];
 expect(saved).toMatchObject({ isClaimed: true, inCart: false });
 await act(async () => api.handleClaimApp(saved));
 expect(f.claim).toHaveBeenCalledTimes(1);
 expect(useCartStore.getState().items).toHaveLength(1);
 expect(api.filteredApps[0]).toMatchObject({ isClaimed: true, inCart: true });
 await act(async () => api.handleClaimApp(saved));
 expect(useCartStore.getState().items).toHaveLength(1);
 await act(async () => useCartStore.setState({ items: [] }));
 expect(api.filteredApps[0]).toMatchObject({ isClaimed: true, inCart: false, claimStatus: 'pending' });
});

it.each(['deploying', 'deployed'] as const)('does not reclaim a %s app', async claimStatus => {
 await act(async () => api.handleClaimApp({ ...app, isClaimed: true, claimStatus }));
 expect(f.claim).not.toHaveBeenCalled();
 expect(useCartStore.getState().items).toHaveLength(0);
});

it.each(['single', 'bulk'])('removes only the item added by a conflicting %s claim and refreshes status', async mode => {
 const manifestFetch = globalThis.fetch;
 let status = 'pending';
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
   url.startsWith('/api/intune/unmanaged-apps')
     ? Response.json({ apps: [{ ...app, isClaimed: true, claimStatus: status }], total: 1 })
     : manifestFetch(url, init)));
 f.claim.mockImplementation(() => { status = 'deployed'; return Response.json({ error: 'This app is already deploying or deployed.' }, { status: 409 }); });
 await act(async () => api.handleRefresh());
 if (mode === 'single') {
   await act(async () => { await expect(api.handleClaimApp(api.filteredApps[0])).rejects.toThrow('already deploying or deployed'); });
 } else {
   await act(async () => api.setClaimAllModal({ apps: [app], results: new Map(), isComplete: false } as never));
   await act(async () => api.processClaimAll([app]));
   expect(api.claimAllModal?.results.get('fixture')).toBe('failed');
 }
 expect(useCartStore.getState().items).toHaveLength(0);
 expect(api.filteredApps[0]).toMatchObject({ isClaimed: true, claimStatus: 'deployed', inCart: false });
});

it('preserves a cart item that was already present when a claim conflicts', async () => {
 const manifestFetch = globalThis.fetch;
 vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
   url.startsWith('/api/intune/unmanaged-apps') ? Response.json({ apps: [], total: 0 }) : manifestFetch(url, init)));
 f.claim.mockImplementationOnce(() => Response.json({ success: true }));
 await act(async () => api.handleClaimApp(app));
 const before = useCartStore.getState().items[0];
 f.claim.mockImplementation(() => Response.json({ error: 'Already deployed' }, { status: 409 }));
 await act(async () => { await expect(api.handleClaimApp(app)).rejects.toThrow('Already deployed'); });
 expect(useCartStore.getState().items).toEqual([before]);
});
