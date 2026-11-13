// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ isAuthenticated: true, isInitializing: false, getAccessToken: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('state=fixture-state') }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children, Var: ({ children }: { children: ReactNode }) => children }));
import Page from './page';
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const info = (account: string) => Response.json({ organization_name: 'Fixture MSP', requested_by: null, signed_in_as: account, can_approve: false, blocked_reason: 'fixture', blocked_message: 'Fixture account', approver_roles: [] });
const render = async () => { await act(async () => root.render(createElement(Page))); };
beforeEach(() => { auth.getAccessToken = vi.fn().mockResolvedValue('token-a'); auth.signIn = vi.fn().mockResolvedValue(false); const node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('loads only the new cached account after the account picker completes', async () => {
 const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => info((options?.headers as Record<string,string>).Authorization === 'Bearer token-b' ? 'account-b@example.test' : 'account-a@example.test'));
 vi.stubGlobal('fetch', fetchMock); await render();
 let resolve!: (value: boolean) => void; auth.signIn.mockImplementationOnce(() => new Promise<boolean>(r => { resolve = r; }));
 const button = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Use another account')!;
 await act(async () => button.click()); auth.getAccessToken = vi.fn().mockResolvedValue('token-b'); await render(); await act(async () => resolve(true));
 expect(fetchMock.mock.calls.filter(([, options]) => (options?.headers as Record<string,string>).Authorization === 'Bearer token-a')).toHaveLength(1);
 expect(document.body.textContent).toContain('account-b@example.test'); expect(document.body.textContent).not.toContain('account-a@example.test');
});
it('ignores an earlier account response that arrives after the new account response', async () => {
 let resolve!: (value: Response) => void;
 vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => (options?.headers as Record<string,string>).Authorization === 'Bearer token-a' ? new Promise<Response>(r => { resolve = r; }) : info('account-b@example.test')));
 await render(); auth.getAccessToken = vi.fn().mockResolvedValue('token-b'); await render();
 expect(document.body.textContent).toContain('account-b@example.test'); await act(async () => resolve(info('account-a@example.test')));
 expect(document.body.textContent).toContain('account-b@example.test'); expect(document.body.textContent).not.toContain('account-a@example.test');
});
it('does not send an obsolete account request after its token resolves', async () => {
 let resolve!: (value: string) => void; auth.getAccessToken = vi.fn(() => new Promise<string>(r => { resolve = r; }));
 const fetchMock = vi.fn(async () => info('account-b@example.test')); vi.stubGlobal('fetch', fetchMock);
 await render(); auth.getAccessToken = vi.fn().mockResolvedValue('token-b'); await render(); await act(async () => resolve('token-a'));
 expect(fetchMock).toHaveBeenCalledTimes(1);
 expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Bearer token-b' });
});
