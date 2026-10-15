// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => children,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => children,
  DropdownMenuSeparator: () => null,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => children,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled: boolean }) => createElement('button', { onClick, disabled }, children),
}));
import { UpdatePolicySelector } from './UpdatePolicySelector';
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { const node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
it('offers all three scopes and sends the explicit selected scope with the automatic policy', async () => {
  const change = vi.fn(async () => {});
  await act(async () => root.render(createElement(UpdatePolicySelector, { currentPolicy: 'auto_update', currentScope: 'all', onPolicyChange: change })));
  for (const text of ['All updates', 'Minor and major', 'Major only']) expect(document.body.textContent).toContain(text);
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Major only');
  await act(async () => button!.click());
  expect(change).toHaveBeenCalledWith('auto_update', 'major');
});
it('shows the security warning for major scope and hides scope choices for notification policies', async () => {
  const change = vi.fn(async () => {});
  await act(async () => root.render(createElement(UpdatePolicySelector, { currentPolicy: 'auto_update', currentScope: 'major', onPolicyChange: change })));
  expect(document.body.textContent).toContain('Major only can delay security fixes');
  await act(async () => root.render(createElement(UpdatePolicySelector, { currentPolicy: 'notify', onPolicyChange: change })));
  expect(document.body.textContent).not.toContain('Automatic update scope');
});
