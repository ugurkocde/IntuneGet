// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children) }));
vi.mock('next/image', () => ({ default: ({ src, onLoad, onError, alt }: { src: string; onLoad?: () => void; onError?: () => void; alt: string }) =>
  createElement('span', { 'data-src': src, role: onLoad ? 'button' : undefined, onClick: onLoad, onDoubleClick: onError }, alt) }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogTrigger: ({ children }: { children: ReactNode }) => children,
  DialogContent: () => null,
  DialogClose: () => null, DialogDescription: () => null, DialogTitle: () => null,
}));
import { QaVmViewer } from '@/components/qa/QaVmViewer';
const container = document.createElement('div');
const root = createRoot(container);
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(async () => { await act(async () => root.render(null)); vi.useRealTimers(); });
describe('live VM frame display', () => {
  it('expires a decoded screenshot when updates stop and removes the live label', async () => {
    vi.useFakeTimers();
    await act(async () => root.render(createElement(QaVmViewer, { src: '/frame?sequence=1', appName: 'Example', phaseLabel: 'Installing', frameState: 'live' })));
    expect(container.textContent).not.toContain('Live');
    await act(async () => (container.querySelector('[role="button"]') as HTMLElement).click());
    expect(container.textContent).toContain('Live');
    expect(container.textContent).toContain('Read-only live view');
    await act(async () => vi.advanceTimersByTime(15_001));
    expect(container.textContent).not.toContain('Read-only live view');
    expect(container.textContent).not.toContain('Live');
    expect(container.textContent).toContain('Waiting for the next VM frame.');
  });
  it('shows an unavailable state when the first frame fails', async () => {
    await act(async () => root.render(createElement(QaVmViewer, { src: '/frame?sequence=2', appName: 'Example', phaseLabel: 'Installing', frameState: 'live' })));
    await act(async () => container.querySelector('[role="button"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(container.textContent).toContain('Live VM view unavailable.');
    expect(container.textContent).not.toContain('Read-only live view');
  });
});
