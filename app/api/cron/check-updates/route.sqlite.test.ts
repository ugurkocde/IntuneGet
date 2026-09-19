import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
let route: typeof import('@/app/api/cron/check-updates/route');

beforeEach(async () => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-cron-'));
  process.env.DATABASE_MODE = 'sqlite';
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
  process.env.PACKAGER_API_KEY = 'test';
  delete process.env.CRON_SECRET;
  vi.doMock('@/lib/db', async () => {
    const sqlite = await import('@/lib/db/sqlite');
    return {
      getDatabase: () => sqlite.sqliteDb,
      isSqliteMode: () => true,
      resetDatabaseInstance: () => {},
    };
  });
  route = await import('@/app/api/cron/check-updates/route');
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_MODE;
  delete process.env.DATABASE_PATH;
  delete process.env.PACKAGER_API_KEY;
  delete process.env.CRON_SECRET;
});

function request(secret?: string): Request {
  return new Request('http://localhost/api/cron/check-updates', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

describe('check-updates cron in SQLite mode', () => {
  it('rejects every request when CRON_SECRET is not configured', async () => {
    expect((await route.GET(request())).status).toBe(401);
    expect((await route.GET(request('undefined'))).status).toBe(401);
  });

  it('runs the SQLite check when the secret matches', async () => {
    process.env.CRON_SECRET = 'secret';
    const response = await route.GET(request('secret'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: 'sqlite', available: 0, triggered: 0 });
  });

  it('rejects a wrong secret', async () => {
    process.env.CRON_SECRET = 'secret';
    expect((await route.GET(request('other'))).status).toBe(401);
  });
});
