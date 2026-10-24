import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { describe, expect, it, vi } from 'vitest';
import { loadSecurityRecheckSchedule } from './security-recheck-schedule';

const hashes = (count: number) => Array.from({ length: count }, (_, i) => i.toString(16).padStart(64, '0'));
const row = (sha256: string) => ({ sha256, demand: false, eligible_at: '2026-10-30T00:00:00Z', malicious: 1 });
function fixture() {
  const rpc = vi.fn(async (_name: string, args: { p_sha256: string[] }) => ({
    data: args.p_sha256.slice(0, 1000).map(row), error: null as null | { message: string },
  }));
  return { rpc, client: { rpc } as unknown as SupabaseClient<Database> };
}

describe('security schedule API row limit', () => {
  it('loads all 1010 supported hashes despite the API 1000 row cap', async () => {
    const f = fixture(); const requested = hashes(1010);
    const result = await loadSecurityRecheckSchedule(f.client, requested);
    expect([...result.keys()]).toEqual(requested);
    expect(f.rpc.mock.calls.map(([, args]) => args.p_sha256.length)).toEqual([1000, 10]);
    expect(f.rpc.mock.calls.every(([name]) => name === 'qa_installer_security_recheck_schedule')).toBe(true);
  });
  it('uses one request at the cap and deduplicates case before batching', async () => {
    const f = fixture(); const requested = hashes(1000);
    expect((await loadSecurityRecheckSchedule(f.client, [...requested, ...requested.map(x => x.toUpperCase())])).size).toBe(1000);
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('rejects an oversized input before calling the API', async () => {
    const f = fixture();
    await expect(loadSecurityRecheckSchedule(f.client, hashes(1011))).rejects.toThrow('invalid');
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it('fails the whole load when the second batch fails', async () => {
    const f = fixture();
    f.rpc.mockImplementationOnce(async (_name, args) => ({ data: args.p_sha256.map(row), error: null }))
      .mockResolvedValueOnce({ data: [], error: { message: 'unavailable' } });
    await expect(loadSecurityRecheckSchedule(f.client, hashes(1010))).rejects.toThrow('unavailable');
    expect(f.rpc).toHaveBeenCalledTimes(2);
  });
  it('rejects a row belonging to a different batch', async () => {
    const f = fixture();
    f.rpc.mockImplementationOnce(async (_name, args) => ({ data: args.p_sha256.map(row), error: null }))
      .mockResolvedValueOnce({ data: [row(hashes(1)[0])], error: null });
    await expect(loadSecurityRecheckSchedule(f.client, hashes(1010))).rejects.toThrow('invalid');
  });
  it('does not request anything for an empty input', async () => {
    const f = fixture(); expect((await loadSecurityRecheckSchedule(f.client, [])).size).toBe(0);
    expect(f.rpc).not.toHaveBeenCalled();
  });
});
