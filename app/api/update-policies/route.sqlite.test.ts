import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const parseAccessTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: parseAccessTokenMock }));

// vitest cannot resolve the CommonJS require() that lib/db uses to lazy-load
// the SQLite adapter, so hand the routes the real adapter directly.
vi.mock('@/lib/db', async () => {
  const sqlite = await import('@/lib/db/sqlite');
  return {
    getDatabase: () => sqlite.sqliteDb,
    isSqliteMode: () => true,
    resetDatabaseInstance: () => {},
  };
});

let tempDir: string;
let route: typeof import('@/app/api/update-policies/route');

beforeEach(async () => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-route-'));
  process.env.DATABASE_MODE = 'sqlite';
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
  process.env.PACKAGER_API_KEY = 'test';
  parseAccessTokenMock.mockReset();
  parseAccessTokenMock.mockResolvedValue({ userId: 'u1', tenantId: 't1' });
  route = await import('@/app/api/update-policies/route');
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_MODE;
  delete process.env.DATABASE_PATH;
  delete process.env.PACKAGER_API_KEY;
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/update-policies', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/update-policies${query}`, {
    headers: { Authorization: 'Bearer test' },
  });
}

describe('update policies route in SQLite mode', () => {
  it('derives a pinned version from the local deployment history', async () => {
    const { sqliteDb } = await import('@/lib/db/sqlite');
    await sqliteDb.uploadHistory.create({
      user_id: 'u1',
      winget_id: 'Vendor.App',
      version: '1.2.3',
      display_name: 'Vendor App',
      intune_app_id: 'app-1',
      intune_tenant_id: 't1',
    });

    const response = await route.POST(
      postRequest({ winget_id: 'Vendor.App', tenant_id: 't1', policy_type: 'pin_version' })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.created).toBe(true);
    expect(payload.policy).toMatchObject({ policy_type: 'pin_version', pinned_version: '1.2.3' });
  });

  it('creates a notify policy and lists it back', async () => {
    const create = await route.POST(
      postRequest({ winget_id: 'Vendor.App', tenant_id: 't1', policy_type: 'notify' })
    );
    expect(create.status).toBe(200);

    const list = await route.GET(getRequest('?tenant_id=t1'));
    const payload = await list.json();
    expect(payload.count).toBe(1);
    expect(payload.policies[0]).toMatchObject({ winget_id: 'Vendor.App', tenant_id: 't1', policy_type: 'notify' });
  });

  it('updates an existing policy instead of inserting a duplicate', async () => {
    await route.POST(postRequest({ winget_id: 'Vendor.App', tenant_id: 't1', policy_type: 'notify' }));
    const second = await route.POST(
      postRequest({ winget_id: 'Vendor.App', tenant_id: 't1', policy_type: 'ignore' })
    );
    const payload = await second.json();
    expect(payload.created).toBe(false);
    expect(payload.policy.policy_type).toBe('ignore');

    const list = await route.GET(getRequest());
    expect((await list.json()).count).toBe(1);
  });

  it('rejects an invalid policy type', async () => {
    const response = await route.POST(
      postRequest({ winget_id: 'Vendor.App', tenant_id: 't1', policy_type: 'nope' })
    );
    expect(response.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    parseAccessTokenMock.mockResolvedValue(null);
    const response = await route.GET(new NextRequest('http://localhost/api/update-policies'));
    expect(response.status).toBe(401);
  });
});
