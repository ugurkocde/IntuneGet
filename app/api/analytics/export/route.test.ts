import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({ jobs: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => ({ userId: 'export-user' }),
}));
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({ jobs: { getByUserId: async () => fixture.jobs.slice(0, 50), getAnalyticsJobs: async () => fixture.jobs } }),
}));

import { GET } from './route';

const request = () => new NextRequest('http://localhost/api/analytics/export?days=30', {
  headers: { Authorization: 'Bearer fixture' },
});

describe('analytics export', () => {
  it('starts with a UTF-8 byte order mark and declares the charset', async () => {
    fixture.jobs = [];
    const response = await GET(request());
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
  });

  it('quotes every cell and neutralises formulas from upstream data', async () => {
    fixture.jobs = [{
      id: 'job-1',
      winget_id: 'Vendor.App',
      display_name: '=HYPERLINK("http://example.test","App")',
      publisher: '@Müller GmbH',
      version: '+2.0',
      architecture: null,
      installer_type: 'msi',
      status: 'failed',
      error_message: '-1 returned, see "log"\nsecond line',
      intune_app_id: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    }];
    const text = await (await GET(request())).text();
    const [header, ...rest] = text.split('\n');

    expect(header).toBe(
      '"Job ID","Winget ID","Display Name","Publisher","Version","Architecture","Installer Type","Status","Intune App ID","Error Message","Created At","Completed At"',
    );
    const row = rest.join('\n');
    expect(row).toContain(`"'=HYPERLINK(""http://example.test"",""App"")"`);
    expect(row).toContain(`"'@Müller GmbH"`);
    expect(row).toContain(`"'+2.0"`);
    expect(row).toContain(`"'-1 returned, see ""log""\nsecond line"`);
    expect(row.startsWith('"job-1","Vendor.App",')).toBe(true);
  });
});

it('exports every row beyond fifty and preserves deployed status', async () => {
 fixture.jobs=Array.from({length:75},(_,i)=>({id:'export-'+i,winget_id:'Example.App',display_name:'Fixture',publisher:'Example',version:'1',architecture:'x64',installer_type:'exe',status:'deployed',error_message:null,intune_app_id:null,created_at:new Date().toISOString(),completed_at:new Date().toISOString()}));
 const text=await(await GET(request())).text();expect(text.trim().split('\n')).toHaveLength(76);expect(text).toContain('"export-74"');expect(text).toContain('"deployed"');
});
