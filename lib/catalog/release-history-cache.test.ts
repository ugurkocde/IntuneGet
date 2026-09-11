import { describe, it, expect } from 'vitest';
import { CompleteHistoryError, requireCompleteHistory } from './release-history-cache';
import type { ReleaseHistoryResult } from './release-history';
const result: ReleaseHistoryResult = {rows:[{winget_id:'Example.App',name:'Example',publisher:null,version:'1',previous_version:null,detected_at:'2026-09-11',release_date:null}],total:1,apps:1,firstTracked:1,months:[],coverageStart:null,sync:null};
describe('release history cache admission', () => {
  it('allows complete records even when a vendor provides no optional metadata', () => {
    expect(requireCompleteHistory(result)).toBe(result);
  });
  it('rejects transiently incomplete results but preserves the records for rendering', () => {
    const partial = {...result, rows:result.rows.map(row=>({...row,detailsUnavailable:true}))};
    expect(() => requireCompleteHistory(partial)).toThrow(CompleteHistoryError);
    try { requireCompleteHistory(partial); } catch (error) {
      expect((error as CompleteHistoryError).result).toBe(partial);
    }
  });
});
