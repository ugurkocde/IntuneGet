import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], error: null as unknown, columns: '' }));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => ({
      select: (columns: string) => { state.columns = columns; return { order: () => ({ limit: async () => ({ data: state.rows, error: state.error }) }) }; },
    }),
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: async () => null, getIpKey: () => 'ip', QA_LIVE_RATE_LIMIT: {} }));
vi.mock('@/lib/qa/public-access', () => ({ isQaLivePublicEnabled: (host: string) => host !== 'blocked.test' }));
import { GET } from './route';

const row = (overrides: Record<string, unknown>) => ({
  github_run_id: '1', github_run_attempt: 1, kind: 'release', winget_id: 'IntuneGet.Curated.7Zip', display_name: '7-Zip',
  tested_version: '26.03', architecture: 'x64', outcome: 'Passed', tested_at_utc: '2026-10-05T10:00:00Z', upgrade_tested: true,
  upgrade_from_version: '26.02', signature_status: 'unsigned', signer: null, defender_status: 'clean', failed_step: 'stale', failed_message: 'stale', ...overrides,
});

describe('public curated QA history', () => {
  beforeEach(() => { state.rows = []; state.error = null; });

  it('returns public run fields and hides failure fields on passes', async () => {
    state.rows = [row({}), row({ github_run_id: '2', outcome: 'Failed', failed_step: 'cleanInstall', failed_message: 'exit code (60001)', kind: 'config' })];
    const response = await GET(new Request('https://www.intuneget.test/api/qa/curated'));
    const body = await response.json();
    expect(body.runs[0]).toMatchObject({ runId: '1:1', outcome: 'Passed', failedStep: null, failedMessage: null, upgradeFromVersion: '26.02' });
    expect(body.runs[1]).toMatchObject({ kind: 'config', failedStep: 'cleanInstall', failedMessage: 'exit code (60001)' });
    // Commands, configuration, tenant identity and private run links are never selected.
    for (const hidden of ['psadt_config', 'tenant', 'install_command', 'uninstall_command', 'github_run_url', 'failed_lifecycle']) expect(state.columns).not.toContain(hidden);
  });

  it('is unavailable where public QA is disabled and degrades on database errors', async () => {
    expect((await GET(new Request('https://blocked.test/api/qa/curated'))).status).toBe(404);
    state.error = { message: 'down' };
    expect((await GET(new Request('https://www.intuneget.test/api/qa/curated'))).status).toBe(503);
  });
});
