// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ user: { id: 'owner', tenantId: 'primary' }, tenant: 'customer-b', jobTenant: 'customer-b', jobOwner: 'owner', suspend: false, ids: '', getToken: vi.fn(), fetch: vi.fn() }));
import { createMsalTestDouble } from '@/test-utils/msal-test-double';
const msal = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof import('@/test-utils/msal-test-double').createMsalTestDouble> }));
vi.mock('@azure/msal-react', () => ({ useMsal: () => msal.client.context, useIsAuthenticated: () => true }));
vi.mock('@/lib/msal-config', () => ({ graphScopes: ['fixture.read'], getAdminConsentUrl: vi.fn() }));
vi.mock('@/hooks/useMspOptional', () => ({ useMspOptional: () => ({ isMspUser: true, selectedTenantId: f.tenant, managedTenants: [{ tenant_id: 'customer-b', display_name: 'Customer B' }] }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (key: string) => key === 'jobs' ? f.ids : null }), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: unknown }) => children, Var: ({ children }: { children: unknown }) => children, useGT: () => (text: string) => text, useLocale: () => 'en' }));
vi.mock('@/components/ProgressStepper', () => ({ ProgressStepper: () => { if (f.suspend) throw new Promise(() => {}); return null; } }));
vi.mock('framer-motion', async () => {
 const React = await import('react'); const cache = new Map();
 return { useReducedMotion: () => true, useInView: () => true, animate: () => ({ stop() {} }), AnimatePresence: ({ children }: { children: unknown }) => children,
 motion: new Proxy({}, { get: (_, tag: string) => {
  if (!cache.has(tag)) cache.set(tag, React.forwardRef(function MotionFixture(props: Record<string, unknown>, ref) {
   const clean = { ...props }; for (const key of ['initial','animate','exit','transition','layout','whileHover','whileTap','variants','custom']) delete clean[key];
   return React.createElement(tag, { ...clean, ref });
  })); return cache.get(tag);
 } }) };
});
import UploadsPage from './page';
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { msal.client = createMsalTestDouble(); f.fetch.mockReset(); vi.stubGlobal('fetch', f.fetch); const node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('keeps owner actions unavailable for a cached account while MSAL initializes', async () => {
 await act(async () => root.render(createElement(UploadsPage)));
 expect(msal.client.instance.getActiveAccount).not.toHaveBeenCalled();
 expect(f.fetch).not.toHaveBeenCalled();
 expect(document.querySelector('[role="alertdialog"]')).toBeNull();
 expect([...document.querySelectorAll('button')].some(b => ['Cancel', 'Dismiss'].includes(b.textContent?.trim() || ''))).toBe(false);
});
