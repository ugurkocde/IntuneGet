import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: parseAccessTokenMock }));

let tempDir: string;
let route: typeof import('@/app/api/updates/refresh/route');

beforeEach(async () => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-refresh-'));
  process.env.DATABASE_MODE = 'sqlite';
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
  process.env.PACKAGER_API_KEY = 'test';
  parseAccessTokenMock.mockReset();
  parseAccessTokenMock.mockResolvedValue({ userId: 'u1', tenantId: 't1' });
  vi.doMock('@/lib/db', async () => {
    const sqlite = await import('@/lib/db/sqlite');
    return {
      getDatabase: () => sqlite.sqliteDb,
      isSqliteMode: () => true,
      resetDatabaseInstance: () => {},
    };
  });
  route = await import('@/app/api/updates/refresh/route');
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_MODE;
  delete process.env.DATABASE_PATH;
  delete process.env.PACKAGER_API_KEY;
});

function request(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost/api/updates/refresh', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('updates refresh route in SQLite mode', () => {
  it('runs the catalog check and returns the SQLite summary', async () => {
    const response = await route.POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, mode: 'sqlite', refreshedCount: 0, updateCount: 0 });
  });

  it('returns 401 without a token', async () => {
    parseAccessTokenMock.mockResolvedValue(null);
    const response = await route.POST(request());
    expect(response.status).toBe(401);
  });
});
