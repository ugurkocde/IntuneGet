// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnmanagedApp } from '@/types/unmanaged';

vi.mock('@/components/AppIcon', () => ({ AppIcon: () => null }));
vi.mock('framer-motion', () => ({ motion: { div: 'div' }, useReducedMotion: () => true }));
import { UnmanagedAppCard } from './UnmanagedAppCard';
import { UnmanagedListRow } from './UnmanagedListRow';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const app = { id: 'app', discoveredAppId: 'app', displayName: 'Example', deviceCount: 1,
  matchedPackageId: 'Example.App', matchStatus: 'matched', isClaimed: true } as UnmanagedApp;
let root: Root, node: HTMLDivElement;
beforeEach(() => { node = document.createElement('div'); document.body.append(node); root = createRoot(node); });
afterEach(async () => { await act(async () => root.unmount()); node.remove(); });

describe.each([['card', UnmanagedAppCard], ['list', UnmanagedListRow]] as const)('%s saved claim recovery', (_, Item) => {
  const onClaim = vi.fn();
  const onLink = vi.fn();
  const render = async (claimStatus: UnmanagedApp['claimStatus'], inCart = false) => {
    await act(async () => root.render(createElement(Item, { app: { ...app, claimStatus, inCart } as UnmanagedApp,
      onClaim, onLink, isClaimLoading: false })));
  };
  it.each([['pending', 'Add to cart'], ['failed', 'Retry']] as const)('recovers %s after reload with an empty cart', async (status, label) => {
    onClaim.mockClear(); await render(status);
    expect(node.textContent).not.toContain('In Cart');
    if (status === 'failed') expect(node.textContent).toContain('Claim failed');
    const button = [...node.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
    expect(button).toBeDefined(); expect(button?.disabled).toBe(false);
    await act(async () => button!.click()); expect(onClaim).toHaveBeenCalledTimes(1);
  });
  it.each(['deploying', 'deployed'] as const)('does not offer recovery for %s', async status => {
    await render(status);
    expect([...node.querySelectorAll('button')].some(b => /Claim|Retry|Add to cart|In Cart/.test(b.textContent || ''))).toBe(false);
  });
  it('updates cart membership without changing persisted claim status', async () => {
    await render('pending'); await render('pending', true);
    expect(node.textContent).toContain('In Cart');
    expect(node.textContent).not.toContain('Add to cart');
    const cartButton = [...node.querySelectorAll('button')].find(b => b.textContent?.includes('In Cart'));
    if (cartButton) expect(cartButton.disabled).toBe(true);
    await render('pending');
    expect(node.textContent).not.toContain('In Cart'); expect(node.textContent).toContain('Add to cart');
  });
});
