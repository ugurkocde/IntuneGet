// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn(), storage: new Map<string, string>() }));
vi.mock('gt-next', () => ({ useGT: () => (text: string) => text, useLocale: () => 'en', T: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('next/dynamic', async () => {
  const { default: Panel } = await import('./ChangelogPanel');
  return { default: () => Panel };
});
vi.mock('@/lib/product-changelog', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/product-changelog')>(), fetchProductChangelog: mocks.load,
}));
import { ChangelogBell } from './ChangelogBell';
import { CHANGELOG_SEEN_KEY } from '@/lib/product-changelog';

const feed = { product: { id: 'intuneget', name: 'IntuneGet', websiteUrl: 'https://www.intuneget.com/' }, entries: [
  { id: 'latest-update', title: '<b>A smoother catalog</b>', summary: 'Large catalogs are easier to browse.', publishedOn: '2026-09-05', type: 'improved' },
] };
let root: Root;
let container: HTMLDivElement;
const bell = () => container.querySelector('button')!;
const flush = () => act(async () => { await Promise.resolve(); });
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click(); }); await flush(); };

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  mocks.storage.clear();
  mocks.load.mockReset().mockResolvedValue(feed);
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: vi.fn((key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { mocks.storage.set(key, value); }),
  } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('changelog bell', () => {
  it('defers badge work, keeps fetched entries unread until opened, and renders plain text without type labels', async () => {
    await act(async () => root.render(createElement(ChangelogBell)));
    expect(mocks.load).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(bell().getAttribute('aria-label')).toContain('unread');
    expect(mocks.storage.has(CHANGELOG_SEEN_KEY)).toBe(false);
    await click(bell());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('h3')?.textContent).toBe(feed.entries[0].title);
    expect(dialog.querySelector('h3 b')).toBeNull();
    expect(dialog.textContent).not.toContain('improved');
    expect(mocks.storage.get(CHANGELOG_SEEN_KEY)).toBe('latest-update');
    expect(bell().getAttribute('aria-label')).toBe('Product updates');
    expect(dialog.querySelector('a')?.getAttribute('href')).toContain('?product=intuneget#change-latest-update');
  });

  it('shows loading, recovers from failure with retry, and supports an empty feed', async () => {
    let reject!: (reason: Error) => void;
    mocks.load.mockImplementation(() => new Promise((_resolve, rejectLoad) => { reject = rejectLoad; }));
    await act(async () => root.render(createElement(ChangelogBell)));
    await click(bell());
    expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading product updates');
    await act(async () => reject(new Error('offline')));
    expect(document.body.textContent).toContain('Updates are temporarily unavailable');
    mocks.load.mockResolvedValue({ ...feed, entries: [] });
    await click(Array.from(document.querySelectorAll('button')).find(el => el.textContent === 'Try again')!);
    expect(document.body.textContent).toContain('No updates published yet');
    expect(mocks.storage.has(CHANGELOG_SEEN_KEY)).toBe(false);
  });

  it('synchronizes read state between mounted bells and remains usable when storage is blocked', async () => {
    vi.mocked(window.localStorage.setItem).mockImplementation(() => { throw new Error('blocked'); });
    await act(async () => root.render(createElement('div', null, createElement(ChangelogBell), createElement(ChangelogBell))));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(2);
    await click(bell());
    expect(container.querySelectorAll('[data-unread]')).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('reflects cross-tab read events and cancels delayed work on unmount', async () => {
    await act(async () => root.render(createElement(ChangelogBell)));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    mocks.storage.set(CHANGELOG_SEEN_KEY, 'latest-update');
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: CHANGELOG_SEEN_KEY })); });
    expect(container.querySelector('[data-unread]')).toBeNull();
    await act(async () => root.render(null));
    mocks.load.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
