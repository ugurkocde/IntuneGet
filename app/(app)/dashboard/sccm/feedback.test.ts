// @vitest-environment happy-dom
import { act, createElement, Suspense, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: vi.fn(), success: vi.fn(), error: vi.fn(), push: vi.fn() }));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ getAccessToken: mocks.token }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('gt-next', () => ({ T: ({ children }: { children: ReactNode }) => children }));
vi.mock('framer-motion', () => ({ AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { div: ({ children }: { children: ReactNode }) => createElement('div', null, children) } }));
vi.mock('@/components/dashboard', () => ({ PageHeader: () => null, AnimatedStatCard: () => null,
  StatCardGrid: ({ children }: { children: ReactNode }) => children, SkeletonGrid: () => null }));
vi.mock('@/components/sccm', () => ({ SccmManualMatchModal: () => null, SccmMigrationStepper: () => null }));
import MigrationPage from './[migrationId]/page';
import ImportPage from './new/page';

let node: HTMLDivElement;
let root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const response = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue('fixture-token');
  node = document.createElement('div'); document.body.append(node); root = createRoot(node);
});
afterEach(async () => { await act(async () => root.unmount()); node.remove(); vi.unstubAllGlobals(); });

it.each(['http', 'network', 'success'])('reports the real bulk exclusion outcome for %s responses', async kind => {
  const apps = ['a', 'b'].map(id => ({ id, migration_id: 'migration-1', display_name: 'Fixture ' + id,
    manufacturer: 'Fixture', version: '1.0', technology: 'MSI', is_deployed: false,
    deployment_count: 0, match_status: 'matched', match_confidence: 1, partial_matches: [] }));
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      const id = JSON.parse(String(options.body)).appId;
      if (id === 'b' && kind === 'network') throw new Error('Fixture network failure');
      return response({}, id === 'b' && kind === 'http' ? 500 : 200);
    }
    if (url.startsWith('/api/sccm/migrations')) return response({ migration: { id: 'migration-1', name: 'Fixture',
      status: 'ready', totalApps: 2, matchedApps: 2, partialMatchApps: 0, unmatchedApps: 0,
      excludedApps: 0, migratedApps: 0, failedApps: 0 } });
    if (url.startsWith('/api/sccm/match?')) return response({ apps, total: 2 });
    throw new Error('Unexpected fixture request');
  });
  vi.stubGlobal('fetch', fetchMock);
  const params = Promise.resolve({ migrationId: 'migration-1' });
  await act(async () => { root.render(createElement(Suspense, { fallback: null }, createElement(MigrationPage, { params }))); await params; });
  expect(node.querySelectorAll('input[type="checkbox"]').length).toBe(3);
  await act(async () => (node.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  const button = [...node.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Exclude Selected');
  expect(button).toBeDefined();
  const initialReads = fetchMock.mock.calls.filter(c => c[0].startsWith('/api/sccm/match?')).length;
  await act(async () => button!.click());
  expect(fetchMock.mock.calls.filter(c => c[1]?.method === 'PATCH')).toHaveLength(2);
  expect(fetchMock.mock.calls.filter(c => c[0].startsWith('/api/sccm/match?')).length).toBeGreaterThan(initialReads);
  if (kind === 'success') {
    expect(mocks.success).toHaveBeenCalledWith('Excluded 2 apps');
    expect(mocks.error).not.toHaveBeenCalled();
    expect(node.textContent).not.toContain('1 app selected');
  } else {
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('Excluded 1 of 2 apps; 1 failed. Please try again.');
    expect(node.textContent).toContain('1 app selected');
  }
});

it.each([200, 400])('shows every numbered row error after an import HTTP %s', async status => {
  const errors = [{ row: 2, message: 'Missing name' }, { row: 5, message: 'Missing identifier' }];
  const body = status === 200
    ? { success: true, migrationId: 'migration-1', validApps: 1, skippedApps: 2, errors }
    : { error: 'No valid applications found in file', errors };
  vi.stubGlobal('fetch', vi.fn(async () => response(body, status)));
  await act(async () => root.render(createElement(ImportPage)));
  const input = node.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true,
    value: [new File(['DisplayName\nFixture'], 'fixture.csv', { type: 'text/csv' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const button = [...node.querySelectorAll('button')].find(b => b.textContent?.includes('Import Applications'))!;
  await act(async () => button.click());
  const items = node.querySelectorAll('ul[aria-label="Import errors"] li');
  expect(items).toHaveLength(2);
  expect(items[0].textContent).toBe('Row 2: Missing name');
  expect(items[1].textContent).toBe('Row 5: Missing identifier');
});

it.each([200, 500])('preserves a new selection while an exclusion batch returns HTTP %s', async status => {
  let finishPatch!: (value: Response) => void;
  const pendingPatch = new Promise<Response>(resolve => { finishPatch = resolve; });
  const apps = ['a', 'b'].map(id => ({ id, migration_id: 'migration-1', display_name: 'Fixture ' + id,
    manufacturer: 'Fixture', version: '1.0', technology: 'MSI', is_deployed: false,
    deployment_count: 0, match_status: 'matched', match_confidence: 1, partial_matches: [] }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') return pendingPatch;
    if (url.startsWith('/api/sccm/migrations')) return response({ migration: { id: 'migration-1', name: 'Fixture',
      status: 'ready', totalApps: 2, matchedApps: 2, partialMatchApps: 0, unmatchedApps: 0,
      excludedApps: 0, migratedApps: 0, failedApps: 0 } });
    return response({ apps, total: 2 });
  }));
  const params = Promise.resolve({ migrationId: 'migration-1' });
  await act(async () => { root.render(createElement(Suspense, { fallback: null }, createElement(MigrationPage, { params }))); await params; });
  const boxes = () => node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await act(async () => boxes()[1].click());
  const exclude = [...node.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Exclude Selected')!;
  await act(async () => exclude.click());
  await act(async () => boxes()[1].click());
  await act(async () => boxes()[2].click());
  await act(async () => finishPatch(response({}, status)));
  expect(boxes()[1].checked).toBe(false);
  expect(boxes()[2].checked).toBe(true);
});

it.each([
  [{ error: 'Migration name is already in use' }, 'Migration name is already in use'],
  [{ error: '<img src=x onerror=alert(1)>' }, '<img src=x onerror=alert(1)>'],
  [{ errors: [{ message: 'Row validation failed' }] }, 'Row validation failed'],
])('shows the import API error as plain text: %j', async (body, expected) => {
  vi.stubGlobal('fetch', vi.fn(async () => response(body, 400)));
  await act(async () => root.render(createElement(ImportPage)));
  const file = new File(['DisplayName,Manufacturer\nFixture,Fixture'], 'fixture.csv', { type: 'text/csv' });
  const input = node.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const button = [...node.querySelectorAll('button')].find(b => b.textContent?.includes('Import Applications'));
  expect(button).toBeDefined(); expect(button!.disabled).toBe(false);
  await act(async () => button!.click());
  expect(mocks.error).toHaveBeenCalledWith(expected);
  expect(node.textContent).toContain(expected);
  expect(node.querySelector('img')).toBeNull();
});

it('clears previous row errors when an import retry fails before receiving a response', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response({ error: 'Invalid rows', errors: [{ row: 2, message: 'Old row failure' }] }, 400))
    .mockRejectedValueOnce(new Error('Fixture network failure'));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => root.render(createElement(ImportPage)));
  const input = node.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true,
    value: [new File(['DisplayName\nFixture'], 'fixture.csv', { type: 'text/csv' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const click = async (text: string) => {
    const button = [...node.querySelectorAll('button')].find(b => b.textContent?.includes(text));
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  await click('Import Applications');
  expect(node.querySelector('ul[aria-label="Import errors"]')).not.toBeNull();
  await click('Try Again');
  await click('Import Applications');
  expect(node.textContent).toContain('Fixture network failure');
  expect(node.querySelector('ul[aria-label="Import errors"]')).toBeNull();
  expect(node.textContent).not.toContain('Old row failure');
});
