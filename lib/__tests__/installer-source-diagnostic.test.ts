import { beforeEach, describe, expect, it, vi } from 'vitest';
const { manifest, probe, createClientMock } = vi.hoisted(() => ({ manifest: vi.fn(), probe: vi.fn(), createClientMock: vi.fn() }));
vi.mock('@/lib/manifest-api', () => ({ getLiveInstallers: manifest }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));
vi.mock('@/lib/installer-download', async original => ({ ...await original<typeof import('@/lib/installer-download')>(), probeInstallerSource: probe }));
import { diagnoseInstallerSource, resetInstallerPreflightStateForTests } from '@/lib/installer-preflight';
const input = { wingetId: 'Example.App', version: '1.0', architecture: 'x64', installerUrl: 'https://source.test/setup', installerSha256: 'A'.repeat(64), installerType: 'msi', sourceType: 'winget' as const };
describe('source diagnostic does not accept an installer', () => {
  let row: Record<string, unknown> | null;
  let writes: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://database.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','test-fixture'); resetInstallerPreflightStateForTests();
    row = { status: 'error', expires_at: '2099-01-01T00:00:00Z', reason_message: 'old failure' }; writes = vi.fn(() => { throw Error('write forbidden'); });
    const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), maybeSingle: vi.fn(async () => ({ data: row, error: null })), upsert: writes, update: writes, insert: writes, delete: writes };
    createClientMock.mockReturnValue({ from: vi.fn(() => builder), rpc: writes });
    manifest.mockResolvedValue([{ url: input.installerUrl, sha256: input.installerSha256, architecture: 'x64', type: 'msi' }]); probe.mockResolvedValue({ outcome: 'reachable', hops: [] });
  });
  it('does an actual probe despite fresh cached failure and leaves shared health unchanged', async () => {
    const before = structuredClone(row);
    expect(await diagnoseInstallerSource(input)).toMatchObject({ probed: true, diagnostic: { outcome: 'reachable' } });
    expect(probe).toHaveBeenCalledOnce(); expect(writes).not.toHaveBeenCalled(); expect(row).toEqual(before);
  });
  it.each(['quarantined','checking'])('never probes %s health with a live lease', async status => {
    row = { status, lease_expires_at: '2099-01-01T00:00:00Z' };
    expect(await diagnoseInstallerSource(input)).toMatchObject({ probed: false }); expect(probe).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
  it('refuses an untrusted manifest tuple without changing its hash or source', async () => {
    manifest.mockResolvedValue([{ url: input.installerUrl, sha256: 'B'.repeat(64) }]);
    expect(await diagnoseInstallerSource(input)).toMatchObject({ probed: false, reason: 'manifest_changed' });
    expect(probe).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
  it('rejects a different execution URL even when the manifest URL and hash match', async () => {
    expect(await diagnoseInstallerSource({ ...input, installerUrl: 'https://other.test/setup', manifestInstallerUrl: input.installerUrl })).toMatchObject({ probed: false, reason: 'source_changed' });
    expect(probe).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
  });
});
