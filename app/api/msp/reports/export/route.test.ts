import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({ client: null as unknown, queries: [] as string[] }));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => ({ userId: 'msp-owner', userEmail: 'owner@example.com' }),
}));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => fixture.client }));

import { GET } from './route';

const jobs = [
  {
    id: 'job-1',
    tenant_id: 'tenant-1',
    winget_id: 'Vendor.App',
    display_name: '+cmd|calc',
    version: '-1.0',
    status: 'failed',
    created_at: '2026-11-01T10:00:00Z',
    completed_at: null,
    error_message: '@SUM(1+1) said "no", twice',
  },
];

function storage() {
  const rows: Record<string, unknown> = {
    msp_user_memberships: { msp_organization_id: 'org-1', role: 'owner', access_mode: 'full' },
    msp_managed_tenants: [{ tenant_id: 'tenant-1', display_name: '=HYPERLINK("http://example.test","Müller")' }],
    packaging_jobs: jobs,
  };
  fixture.queries = [];
  fixture.client = {
    from: (table: string) => {
      fixture.queries.push(table);
      const result = { data: rows[table] ?? null, error: null };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'limit']) chain[method] = () => chain;
      chain.single = async () => result;
      chain.then = (resolve: (value: unknown) => unknown) => resolve(result);
      return chain;
    },
  };
}

const request = (query: string) => new NextRequest(`http://localhost/api/msp/reports/export${query}`, {
  headers: { Authorization: 'Bearer fixture' },
});

beforeEach(() => { storage(); });

describe('MSP report export', () => {
  it.each([
    ['a header injection attempt', '?start_date=2026-01-01%22%0D%0AX-Injected:%201'],
    ['a path', '?end_date=..%2F..%2Fsecret'],
    ['a date without separators', '?start_date=20260101'],
    ['a date with a time', '?start_date=2026-01-01T00:00:00Z'],
    ['a month that does not exist', '?start_date=2026-13-01'],
    ['a day that does not exist', '?end_date=2026-02-31'],
    ['free text', '?start_date=yesterday'],
  ])('rejects %s before reading any deployment data', async (_label, query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'start_date and end_date must use the YYYY-MM-DD format' });
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(fixture.queries).not.toContain('packaging_jobs');
  });

  it('uses validated dates in the download filename', async () => {
    const response = await GET(request('?start_date=2026-10-01&end_date=2026-10-31'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="msp-deployments-2026-10-01-to-2026-10-31.csv"',
    );
  });

  it('accepts a request without dates', async () => {
    const response = await GET(request(''));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="msp-deployments-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
  });

  it('starts with a UTF-8 byte order mark and declares the charset', async () => {
    const response = await GET(request(''));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  });

  it('quotes every cell and neutralises formulas from tenant and job data', async () => {
    const response = await GET(request(''));
    const [header, row] = (await response.text()).split('\n');
    expect(header).toBe(
      '"Job ID","Tenant Name","Package ID","Package Name","Version","Status","Created At","Completed At","Error Message"',
    );
    expect(row).toBe([
      '"job-1"',
      `"'=HYPERLINK(""http://example.test"",""Müller"")"`,
      '"Vendor.App"',
      `"'+cmd|calc"`,
      `"'-1.0"`,
      '"failed"',
      '"2026-11-01T10:00:00Z"',
      '""',
      `"'@SUM(1+1) said ""no"", twice"`,
    ].join(','));
  });
});
