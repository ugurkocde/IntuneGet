import { describe, it, expect, vi } from 'vitest';
import { loadReleaseMetadata, releasePairKey } from './release-metadata';
const rows = Array.from({length: 40}, (_, i) => ({winget_id: `Example.${i}`, version: '1.0'}));
const evidence = (batch: typeof rows) => batch.map(row => ({...row, release_notes_url: 'https://example.com/notes', installer_sha256: 'a'.repeat(64)}));
describe('release metadata loading', () => {
  it('retries a transient failure with a new request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({data:null,error:{},status:0}).mockResolvedValueOnce({data:evidence(rows.slice(0,1)),error:null,status:200});
    const result = await loadReleaseMetadata(rows.slice(0,1),fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.metadata).toHaveLength(1);
    expect(result.unavailable.size).toBe(0);
  });
  it('preserves three successful groups when one group times out twice', async () => {
    const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetch = vi.fn(async (batch: typeof rows) => {
      if(batch[0].winget_id==='Example.0') throw new Error('Timeout');
      return {data:evidence(batch),error:null,status:200};
    });
    const result = await loadReleaseMetadata(rows,fetch);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(result.metadata).toHaveLength(30);
    expect(result.unavailable.size).toBe(10);
    expect(result.unavailable.has(releasePairKey(rows[10]))).toBe(false);
    warn.mockRestore();
  });
  it('does not retry permanent errors or confuse absent metadata with a failed request', async () => {
    const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetch = vi.fn().mockResolvedValue({data:null,error:{code:'42501'},status:403});
    expect((await loadReleaseMetadata(rows.slice(0,1),fetch)).unavailable.size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await loadReleaseMetadata(rows.slice(0,1),async()=>({data:[],error:null,status:200}))).unavailable.size).toBe(0);
    warn.mockRestore();
  });
});
