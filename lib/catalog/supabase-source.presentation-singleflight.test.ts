import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';

let release: () => void;
let gate: Promise<void>;
let fetchMock: ReturnType<typeof vi.fn>;
let missing = false;
beforeEach(() => {
  missing = false;
  gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-key');
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    await gate;
    const url = new URL(String(input));
    if (url.pathname.endsWith('/version_history')) return Response.json([{ version: '1' }]);
    if (url.pathname.endsWith('/get_locale_variants')) return Response.json([]);
    return Response.json(missing ? null : { winget_id: url.searchParams.get('winget_id')?.slice(3),
      name: 'Fixture', latest_version: '1', is_locale_variant: false });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { release(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const started = () => vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));

it('shares a pending presentation read across 22 concurrent callers of the same app', async () => {
  const source = new SupabaseCatalogSource();
  const calls = Array.from({ length: 22 }, () => source.getAppByWingetId('Fixture.App', { presentationOnly: true }));
  try {
    await started();
    // Models many requests waiting for upstream headers, not React metadata
    // deduplication inside one request. OLD dispatches 44 reads here.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally { release(); }
  const values = await Promise.all(calls);
  expect(values.every(x => x?.app.winget_id === 'Fixture.App')).toBe(true);
  expect(values.every(x => x?.versions.join() === '1')).toBe(true);
  for (const [url] of fetchMock.mock.calls) {
    if (String(url).includes('version_history')) expect(new URL(String(url)).searchParams.get('limit')).toBe('10');
  }
});

it('does not retain completed presentation results', async () => {
  const source = new SupabaseCatalogSource(); release();
  await source.getAppByWingetId('Fixture.App', { presentationOnly: true });
  await source.getAppByWingetId('Fixture.App', { presentationOnly: true });
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('does not make a later request join an old stalled presentation read', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const source = new SupabaseCatalogSource();
  const first = source.getAppByWingetId('Fixture.App', { presentationOnly: true });
  await started();
  now = 1001;
  const later = source.getAppByWingetId('Fixture.App', { presentationOnly: true });
  try {
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  } finally { release(); }
  expect((await Promise.all([first, later])).every(Boolean)).toBe(true);
});

it('keeps a newer pending read tracked when the older read finishes', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const source = new SupabaseCatalogSource();
  const first = source.getAppByWingetId('Fixture.App', { presentationOnly: true });
  const releaseFirst = release;
  await started();
  now = 1001;
  gate = new Promise<void>(resolve => { release = resolve; });
  const second = source.getAppByWingetId('Fixture.App', { presentationOnly: true });
  try {
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    releaseFirst();
    await first;
    const third = source.getAppByWingetId('Fixture.App', { presentationOnly: true });
    // If the older completion evicts the new entry, this starts two extra
    // requests instead of sharing the still-pending second read.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    release();
    expect((await Promise.all([second, third])).every(Boolean)).toBe(true);
  } finally { releaseFirst(); release(); }
});

it('does not cache a missing presentation result', async () => {
  const source = new SupabaseCatalogSource(); missing = true; release();
  expect(await source.getAppByWingetId('Fixture.App', { presentationOnly: true })).toBeNull();
  missing = false;
  expect((await source.getAppByWingetId('Fixture.App', { presentationOnly: true }))?.app.name).toBe('Fixture');
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('keeps different app identities and source instances independent', async () => {
  const source = new SupabaseCatalogSource();
  const calls = [source.getAppByWingetId('Fixture.App', { presentationOnly: true }),
    source.getAppByWingetId('fixture.app', { presentationOnly: true }),
    new SupabaseCatalogSource().getAppByWingetId('Fixture.App', { presentationOnly: true })];
  try { await started(); expect(fetchMock).toHaveBeenCalledTimes(6); } finally { release(); }
  expect((await Promise.all(calls)).map(x => x?.app.winget_id)).toEqual(['Fixture.App', 'fixture.app', 'Fixture.App']);
});

it('leaves full detail and locale lookups outside presentation sharing', async () => {
  const source = new SupabaseCatalogSource();
  const calls = [source.getAppByWingetId('Fixture.App'), source.getAppByWingetId('Fixture.App')];
  try { await started(); expect(fetchMock).toHaveBeenCalledTimes(4); } finally { release(); }
  await Promise.all(calls);
  expect(fetchMock).toHaveBeenCalledTimes(6);
});

it('bounds tracked keys without denying uncached reads or dropping tracked sharing', async () => {
  const source = new SupabaseCatalogSource();
  const calls = Array.from({ length: 64 }, (_, i) => source.getAppByWingetId(`Fixture.${i}`, { presentationOnly: true }));
  calls.push(source.getAppByWingetId('Fixture.0', { presentationOnly: true }));
  calls.push(source.getAppByWingetId('Fixture.overflow', { presentationOnly: true }));
  calls.push(source.getAppByWingetId('Fixture.overflow', { presentationOnly: true }));
  try { await started(); expect(fetchMock).toHaveBeenCalledTimes(132); } finally { release(); }
  expect((await Promise.all(calls)).every(Boolean)).toBe(true);
});
