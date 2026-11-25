import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

// Execute the page's real foreground reads without rendering JSX or accessing services.
function foreground(hold?: string) {
  const warnings: unknown[][] = [];
  const waits = Object.fromEntries(['resolveApp', 'qa', 'changelog', 'installer', 'related'].map(k => [k, deferred()]));
  const app = { winget_id: 'Fixture.Private', latest_version: '1', category: 'utilities' };
  const source = {
    getAppByWingetId: () => waits.resolveApp.promise,
    appExistsCaseInsensitive: () => Promise.resolve(null),
    getQaResult: () => waits.qa.promise,
    getInstallationChangelog: () => waits.changelog.promise,
    getVersionInstallerInfo: () => waits.installer.promise,
    getPopularApps: () => waits.related.promise,
  };
  const load = (body: string, mocks: Record<string, unknown> = {}) => {
    const sandboxModule = { exports: {} as Record<string, (...args: never[]) => unknown> };
    vm.runInNewContext(ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { module: sandboxModule, exports: sandboxModule.exports, require: (id: string) => mocks[id] ?? {},
        console: { warn: (...args: unknown[]) => warnings.push(args) }, performance,
        setTimeout, clearTimeout });
    return sandboxModule.exports;
  };
  const traceFile = path.resolve('lib/catalog/stage-trace.ts');
  const tracer = fs.existsSync(traceFile) ? load(fs.readFileSync(traceFile, 'utf8')) : {};
  const page = fs.readFileSync(path.resolve('app/(marketing)/apps/[wingetId]/page.tsx'), 'utf8');
  const start = page.indexOf('export default async function AppDetailPage');
  const end = page.indexOf('  const qa = qaRead.qa;', start);
  const body = page.slice(0, page.indexOf('// Maps the catalog')) + page.slice(start, end) + 'return {qaRead,changelog,installer,relatedResult};}';
  const entry = load(body, { react: { cache: (f: unknown) => f }, '@/lib/catalog': { getCatalogSource: () => source },
    '@/lib/catalog/stage-trace': tracer, 'next/navigation': { notFound: () => { throw Error('missing'); } } });
  const result = entry.default({ params: Promise.resolve({ wingetId: 'Fixture.Private' }) } as never) as Promise<Record<string, unknown>>;
  const values: Record<string, unknown> = { resolveApp: { app, versions: [] }, qa: null, changelog: null, installer: null, related: { data: [] } };
  for (const [key, wait] of Object.entries(waits)) if (key !== hold) wait.resolve(values[key]);
  return { warnings, waits, values, result };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('app detail pending stage diagnostics', () => {
  it('identifies a stalled related read without exposing app data or changing its result', async () => {
    const f = foreground('related'); await drain();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.warnings).toHaveLength(1);
    expect(f.warnings[0][0]).toBe('Catalog page stage pending');
    expect(f.warnings[0][1]).toMatchObject({ route: 'appdetail', pending: ['related'], notStarted: [] });
    expect(JSON.stringify(f.warnings)).not.toContain('Fixture');
    await vi.advanceTimersByTimeAsync(20000); expect(f.warnings).toHaveLength(1);
    f.waits.related.resolve(f.values.related);
    expect((await f.result).relatedResult).toEqual(f.values.related);
  });
  it('distinguishes unresolved app lookup from branches not yet started', async () => {
    const f = foreground('resolveApp'); await drain();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.warnings[0]?.[1]).toMatchObject({ pending: ['resolveApp'], notStarted: ['qa', 'changelog', 'installer', 'related'] });
    f.waits.resolveApp.resolve(f.values.resolveApp); await f.result;
  });
  it('clears its timer and stays silent for fast reads', async () => {
    const f = foreground(); await f.result;
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.warnings).toEqual([]);
  });
  it('clears its timer when app resolution exits through notFound', async () => {
    const f = foreground('resolveApp'); await drain();
    const rejected = expect(f.result).rejects.toThrow('missing');
    f.waits.resolveApp.reject(Error('private failure')); await rejected;
    await vi.advanceTimersByTimeAsync(20000); expect(f.warnings).toEqual([]);
  });
  it('preserves a rejected related read fallback', async () => {
    const f = foreground('related'); await drain(); f.waits.related.reject(Error('private failure'));
    expect((await f.result).relatedResult).toBeNull();
    await vi.advanceTimersByTimeAsync(20000); expect(f.warnings).toEqual([]);
  });
});
