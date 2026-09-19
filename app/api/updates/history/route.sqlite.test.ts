import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: parseAccessTokenMock }));

// vitest cannot resolve the CommonJS require() that lib/db uses to lazy-load
// the SQLite adapter, so hand the route the real adapter directly.
vi.mock('@/lib/db', async () => {
  const sqlite = await import('@/lib/db/sqlite');
  return {
    getDatabase: () => sqlite.sqliteDb,
    isSqliteMode: () => true,
    resetDatabaseInstance: () => {},
  };
});

let tempDir: string;
let GET: typeof import('@/app/api/updates/history/route').GET;

beforeEach(async () => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-history-'));
  process.env.DATABASE_MODE = 'sqlite';
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
  process.env.PACKAGER_API_KEY = 'test';
  parseAccessTokenMock.mockReset();
  parseAccessTokenMock.mockResolvedValue({ userId: 'u1', tenantId: 't1' });
  ({ GET } = await import('@/app/api/updates/history/route'));
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_MODE;
  delete process.env.DATABASE_PATH;
  delete process.env.PACKAGER_API_KEY;
});

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/updates/history${query}`, {
    headers: { Authorization: 'Bearer test' },
  });
}

describe('auto-update history route in SQLite mode', () => {
  it('returns history joined with the policy target for the signed-in user', async () => {
    const { sqliteDb } = await import('@/lib/db/sqlite');
    const policy = await sqliteDb.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'auto_update',
    });
    await sqliteDb.autoUpdateHistory.create({
      policy_id: policy.id,
      from_version: '1.0.0',
      to_version: '1.1.0',
      update_type: 'minor',
      status: 'completed',
    });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.count).toBe(1);
    expect(payload.history[0]).toMatchObject({
      from_version: '1.0.0',
      to_version: '1.1.0',
      status: 'completed',
      policy: { winget_id: 'Vendor.App', tenant_id: 't1' },
    });
  });

  it('honors the status filter and tenant scope', async () => {
    const { sqliteDb } = await import('@/lib/db/sqlite');
    const policy = await sqliteDb.updatePolicies.upsert({
      user_id: 'u1',
      tenant_id: 't1',
      winget_id: 'Vendor.App',
      policy_type: 'auto_update',
    });
    await sqliteDb.autoUpdateHistory.create({
      policy_id: policy.id,
      from_version: '1.0.0',
      to_version: '1.1.0',
      update_type: 'minor',
      status: 'failed',
    });

    expect((await (await GET(request('?status=failed'))).json()).count).toBe(1);
    expect((await (await GET(request('?status=completed'))).json()).count).toBe(0);
    expect((await (await GET(request('?tenant_id=t2'))).json()).count).toBe(0);
  });

  it('returns 401 without a token', async () => {
    parseAccessTokenMock.mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/api/updates/history'));
    expect(response.status).toBe(401);
  });
});
