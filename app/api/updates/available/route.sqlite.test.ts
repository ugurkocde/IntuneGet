import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: parseAccessTokenMock }));

let tempDir: string;
let route: typeof import('@/app/api/updates/available/route');

beforeEach(async () => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-available-'));
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
  route = await import('@/app/api/updates/available/route');
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_MODE;
  delete process.env.DATABASE_PATH;
  delete process.env.PACKAGER_API_KEY;
});

function getRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/updates/available${query}`, {
    headers: { Authorization: 'Bearer test' },
  });
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/updates/available', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedResult() {
  const { sqliteDb } = await import('@/lib/db/sqlite');
  return sqliteDb.updateCheckResults.upsert({
    user_id: 'u1',
    tenant_id: 't1',
    winget_id: 'Vendor.App',
    intune_app_id: 'app-1',
    display_name: 'Vendor App',
    current_version: '1.0.0',
    latest_version: '1.1.0',
    is_critical: true,
  });
}

describe('available updates route in SQLite mode', () => {
  it('lists detected updates and counts critical ones', async () => {
    await seedResult();
    const response = await route.GET(getRequest());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.criticalCount).toBe(1);
    expect(payload.updates[0]).toMatchObject({ winget_id: 'Vendor.App', current_version: '1.0.0', latest_version: '1.1.0' });
  });

  it('dismisses and restores updates', async () => {
    const created = await seedResult();

    const dismiss = await route.PATCH(patchRequest({ update_ids: [created.id], action: 'dismiss' }));
    expect(dismiss.status).toBe(200);
    expect(await (await route.GET(getRequest())).json()).toMatchObject({ count: 0 });
    expect(await (await route.GET(getRequest('?include_dismissed=true'))).json()).toMatchObject({ count: 1 });

    await route.PATCH(patchRequest({ update_ids: [created.id], action: 'restore' }));
    expect(await (await route.GET(getRequest())).json()).toMatchObject({ count: 1 });
  });

  it('rejects an invalid action', async () => {
    const response = await route.PATCH(patchRequest({ update_ids: ['x'], action: 'nope' }));
    expect(response.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    parseAccessTokenMock.mockResolvedValue(null);
    const response = await route.GET(new NextRequest('http://localhost/api/updates/available'));
    expect(response.status).toBe(401);
  });
});
