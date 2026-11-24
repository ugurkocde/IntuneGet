import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { applyApplicationPackagingAdapter } from '../packaging-adapters';

const wingetId = 'BayerischesLandesamtfuerSteuern.ElsterAuthenticator';

describe('ElsterAuthenticator unattended removal profile', () => {
  it('adds only the vendor quiet removal mode without changing the caller config', () => {
    const input = { ...DEFAULT_PSADT_CONFIG, reviewedUninstallArguments: [] };
    const before = structuredClone(input);
    const result = applyApplicationPackagingAdapter(wingetId, input);
    expect(result.reviewedUninstallArguments).toEqual(['-q']);
    expect(input).toEqual(before);
    expect(result).toEqual({ ...before, reviewedUninstallArguments: ['-q'] });
    expect(applyApplicationPackagingAdapter(wingetId, result)).toEqual(result);
  });

  it('does not infer quiet removal for another package or a lookalike identifier', () => {
    for (const id of [
      'BayerischesLandesamtfuerSteuern.Other',
      `${wingetId}Extra`,
      'Example.ElsterAuthenticator',
    ]) {
      expect(applyApplicationPackagingAdapter(id, DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments ?? []).toEqual([]);
    }
  });
});
