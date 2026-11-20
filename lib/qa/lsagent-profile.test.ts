import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { applyApplicationPackagingAdapter } from '../packaging-adapters';

describe('LsAgent unattended removal profile', () => {
  it('supplies the vendor removal mode missing from the 12.6.3.3 failed profile', () => {
    const input = { ...DEFAULT_PSADT_CONFIG, reviewedUninstallArguments: [] };
    const result = applyApplicationPackagingAdapter('Lansweeper.LsAgent', input);
    expect(result.reviewedUninstallArguments).toEqual(['--mode', 'unattended']);
    expect(input.reviewedUninstallArguments).toEqual([]);
    expect(applyApplicationPackagingAdapter('Lansweeper.LsAgent', result)
      .reviewedUninstallArguments).toEqual(['--mode', 'unattended']);
  });

  it('does not change other Lansweeper packages or lookalike IDs', () => {
    for (const id of ['Lansweeper.Other', 'Lansweeper.LsAgentExtra', 'Example.App']) {
      expect(applyApplicationPackagingAdapter(id, DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments ?? []).toEqual([]);
    }
  });
});
