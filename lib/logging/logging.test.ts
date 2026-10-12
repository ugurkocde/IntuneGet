import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import { createFileSink } from './file-sink';
import { formatLogLine, levelAllows, parseLogLevel } from './log-format';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function temp() { const d = await mkdtemp(path.join(tmpdir(), 'intuneget-log-test-')); dirs.push(d); return d; }
describe('server logging', () => {
  it('defaults safely and filters each level', () => {
    expect(parseLogLevel('invalid')).toBe('info'); expect(parseLogLevel('debug')).toBe('debug');
    expect(levelAllows('warn', 'info')).toBe(false); expect(levelAllows('warn', 'error')).toBe(true);
  });
  it('redacts credentials, URLs, email, IDs and forged lines', () => {
    const line = formatLogLine('error', ['Bearer abcdefghijk https://example.invalid?sig=secret user@example.invalid 11111111-2222-3333-4444-555555555555\nforged']);
    for (const secret of ['abcdefghijk', 'https://', 'user@example.invalid', '11111111-2222']) expect(line).not.toContain(secret);
    expect(line.split('\n')).toHaveLength(2); expect(line).toContain('forged');
  });
  it('never invokes getters or custom inspect', () => {
    const run = vi.fn(() => 'private');
    const obj = { get secret() { return run(); }, [inspect.custom]: run };
    expect(formatLogLine('info', [obj])).not.toContain('private'); expect(run).not.toHaveBeenCalled();
  });
  it('bounds formatting', () => { expect(formatLogLine('info', ['x'.repeat(100_000)]).length).toBeLessThan(8300); });
  it('redacts an incomplete email token without expensive rescanning', () => {
    expect(formatLogLine('info', ['x'.repeat(100_000) + '@partial'])).not.toContain('@partial');
  });
  it.each(['a@example.invalid', '11111111-2222-3333-4444-555555555555'])('redacts a value crossing the truncation boundary: %s', value => {
    const line = formatLogLine('info', ['x'.repeat(8188) + ' ' + value]);
    expect(line).not.toContain(value.slice(0, 4));
    expect(line).toContain('[re');
  });
  it.each(['flush', 'close'] as const)('reports an idle oversized drop during %s', async operation => {
    const dir = await temp(); const sink = createFileSink({ dir, maxBytes: 100 });
    sink.write('x'.repeat(101)); await sink[operation]();
    expect(await readFile(path.join(dir, 'intuneget.log'), 'utf8')).toBe('[intuneget-log] dropped 1 lines\n');
    await sink.close();
    expect(await readFile(path.join(dir, 'intuneget.log'), 'utf8')).toBe('[intuneget-log] dropped 1 lines\n');
  });
  it('creates the file lazily and rotates without losing accepted order', async () => {
    const dir = path.join(await temp(), 'logs'); const sink = createFileSink({ dir, maxBytes: 100, backups: 3 });
    await expect(readdir(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    for (let i = 0; i < 20; i++) sink.write(i + ':' + 'x'.repeat(30) + '\n');
    await sink.close(); const names = await readdir(dir);
    expect(names.sort()).toEqual(['intuneget.log', 'intuneget.log.1', 'intuneget.log.2', 'intuneget.log.3']);
    for (const name of names) expect(Buffer.byteLength(await readFile(path.join(dir, name)))).toBeLessThanOrEqual(100);
    expect(await readFile(path.join(dir, 'intuneget.log'), 'utf8')).toContain('19:');
  });
  it('bounds the queue and records drops once', async () => {
    const dir = await temp(); const sink = createFileSink({ dir, maxLines: 1 });
    sink.write('first\n'); sink.write('second\n'); sink.write('third\n'); await sink.close();
    const text = await readFile(path.join(dir, 'intuneget.log'), 'utf8');
    expect(text).toContain('first'); expect(text).not.toContain('second'); expect(text).toContain('dropped 2 lines');
  });
  it('disables a failed sink once without exposing paths', async () => {
    const dir = await temp(); const file = path.join(dir, 'occupied'); await writeFile(file, 'x');
    const notice = vi.fn(); const sink = createFileSink({ dir: path.join(file, 'child'), notice });
    sink.write('first\n'); await sink.flush(); sink.write('second\n'); await sink.close();
    expect(sink.disabled).toBe(true); expect(notice).toHaveBeenCalledTimes(1);
    expect(notice.mock.calls[0][0]).not.toContain(dir);
  });
  it.each([{ VERCEL: '1' }, { DEPLOYMENT_MODE: 'hosted' }, { NEXT_PHASE: 'phase-production-build' }])('does not patch console in hosted/build %s', async env => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const before = console.log; const { installConsoleCapture } = await import('./node-register');
    installConsoleCapture(); expect(console.log).toBe(before);
  });
  it('captures terminal arguments unchanged and installs only once', async () => {
    vi.stubEnv('VERCEL', ''); vi.stubEnv('DEPLOYMENT_MODE', 'self-hosted'); vi.stubEnv('NEXT_PHASE', '');
    vi.stubEnv('INTUNEGET_LOG_DIR', ''); vi.stubEnv('INTUNEGET_LOG_LEVEL', 'warn');
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { installConsoleCapture } = await import('./node-register'); installConsoleCapture();
    const installed = console.warn; installConsoleCapture(); expect(console.warn).toBe(installed);
    const object = { detail: 'unchanged' }; console.warn('message', object); console.log('hidden');
    expect(warn).toHaveBeenCalledWith('message', object); expect(log).not.toHaveBeenCalled();
    Object.assign(console, original); Reflect.deleteProperty(globalThis, Symbol.for('intuneget.consoleCapture'));
  });
});
