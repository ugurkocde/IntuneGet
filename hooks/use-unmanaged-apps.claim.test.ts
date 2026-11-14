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
