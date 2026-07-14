import { describe, expect, it } from 'vitest';
import {
  hashesEqual,
  isLikelyMutableInstallerUrl,
  isPublicIpAddress,
} from '@/lib/installer-download';

describe('installer download safety helpers', () => {
  it('rejects private and reserved network addresses', () => {
    expect(isPublicIpAddress('127.0.0.1')).toBe(false);
    expect(isPublicIpAddress('10.0.0.10')).toBe(false);
    expect(isPublicIpAddress('169.254.169.254')).toBe(false);
    expect(isPublicIpAddress('::1')).toBe(false);
    expect(isPublicIpAddress('fd00::1')).toBe(false);
    expect(isPublicIpAddress('8.8.8.8')).toBe(true);
    expect(isPublicIpAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('compares only valid SHA256 values', () => {
    const hash = 'a'.repeat(64);
    expect(hashesEqual(hash, hash.toUpperCase())).toBe(true);
    expect(hashesEqual(hash, 'b'.repeat(64))).toBe(false);
    expect(hashesEqual('not-a-hash', 'not-a-hash')).toBe(false);
  });

  it('uses a shorter trust window for mutable or ambiguous URLs', () => {
    expect(isLikelyMutableInstallerUrl(
      'https://example.test/releases/1.2.3/setup.exe',
      '1.2.3',
    )).toBe(false);
    expect(isLikelyMutableInstallerUrl(
      'https://example.test/download/latest/setup.exe',
      '1.2.3',
    )).toBe(true);
    expect(isLikelyMutableInstallerUrl(
      'https://example.test/download/setup.exe?bad=%ZZ',
      '1.2.3',
    )).toBe(true);
  });
});
