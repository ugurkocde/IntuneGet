import { describe, expect, it } from 'vitest';
import { normalizeStoredInstallers } from './stored-installers';

describe('normalizeStoredInstallers', () => {
  const entries = [{ Architecture: 'arm64', Scope: 'user', InstallerSha256: 'A'.repeat(64) }];

  it('preserves array-backed records by identity', () => {
    expect(normalizeStoredInstallers(entries)).toBe(entries);
  });

  it('decodes one legacy string level without adding defaults', () => {
    expect(normalizeStoredInstallers(JSON.stringify(entries))).toEqual(entries);
    expect(normalizeStoredInstallers('[{}]')).toEqual([{}]);
  });

  it.each([null, undefined, 42, {}, '{invalid', '{}', '42', 'null', '[null]', '[1]', '[[]]', JSON.stringify(JSON.stringify(entries))])(
    'rejects malformed or non-list legacy metadata: %j', (value) => {
      expect(normalizeStoredInstallers(value)).toBeNull();
    }
  );
});
