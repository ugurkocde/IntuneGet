import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildByteRanges,
  hashesEqual,
  isLikelyMutableInstallerUrl,
  isPublicIpAddress,
  parseByteContentRange,
  parsePublisherChecksum,
  publisherChecksumUrlForInstaller,
  shouldUseRangedInstallerHash,
  withInstallerDownloadDeadline,
} from '@/lib/installer-download';

afterEach(() => {
  vi.useRealTimers();
});

describe('installer download safety helpers', () => {
  it('enforces a wall-clock deadline even while an operation remains active', async () => {
    vi.useFakeTimers();
    const result = withInstallerDownloadDeadline(25, (signal) =>
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    );

    const assertion = expect(result).rejects.toMatchObject({
      name: 'InstallerDownloadDeadlineError',
      message: 'Installer verification exceeded the 25ms wall-clock deadline',
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

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

  it('selects ranged hashing only for the reviewed PostgresPro HTTPS origin', () => {
    expect(shouldUseRangedInstallerHash(
      'https://repo.postgrespro.ru/win/64/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBe(true);
    expect(shouldUseRangedInstallerHash(
      'http://repo.postgrespro.ru/win/64/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBe(false);
    expect(shouldUseRangedInstallerHash(
      'https://repo.postgrespro.ru.example.test/setup.exe',
    )).toBe(false);
  });

  it('uses a publisher checksum only for exact official PostgresPro installer URLs', () => {
    expect(publisherChecksumUrlForInstaller(
      'https://repo.postgrespro.com/win/64/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBe(
      'https://repo.postgrespro.com/win/64/PostgreSQL_17.7_64bit_Setup.exe.sha256sum',
    );
    expect(publisherChecksumUrlForInstaller(
      'http://repo.postgrespro.com/win/64/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBeNull();
    expect(publisherChecksumUrlForInstaller(
      'https://repo.postgrespro.com.example.test/win/64/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBeNull();
    expect(publisherChecksumUrlForInstaller(
      'https://repo.postgrespro.com/win/32/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBeNull();
    expect(publisherChecksumUrlForInstaller(
      'https://repo.postgrespro.com/win/64/archive/PostgreSQL_17.7_64bit_Setup.exe',
    )).toBeNull();
    expect(publisherChecksumUrlForInstaller(
      'https://repo.postgrespro.com/win/64/PostgreSQL_17.7_64bit_Setup.exe?mirror=1',
    )).toBeNull();
  });

  it('strictly parses the publisher checksum for the exact installer filename', () => {
    const checksum = '58f961e7ee44676c1fecb111e4eb5429701cdbc3ee057df336d378b2094dc94d';
    expect(parsePublisherChecksum(
      `${checksum}  PostgreSQL_17.7_64bit_Setup.exe\n`,
      'PostgreSQL_17.7_64bit_Setup.exe',
    )).toBe(checksum.toUpperCase());
    expect(parsePublisherChecksum(
      `${checksum}  different.exe\n`,
      'PostgreSQL_17.7_64bit_Setup.exe',
    )).toBeNull();
    expect(parsePublisherChecksum(
      `${checksum}  PostgreSQL_17.7_64bit_Setup.exe\nextra`,
      'PostgreSQL_17.7_64bit_Setup.exe',
    )).toBeNull();
  });

  it('builds ordered non-overlapping byte ranges including a short final range', () => {
    expect(buildByteRanges(10, 4)).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 8, end: 9 },
    ]);
    expect(buildByteRanges(0, 4)).toEqual([]);
  });

  it('strictly parses complete byte content-range headers', () => {
    expect(parseByteContentRange('bytes 0-1048575/157645328')).toEqual({
      start: 0,
      end: 1048575,
      total: 157645328,
    });
    expect(parseByteContentRange('bytes */157645328')).toBeNull();
    expect(parseByteContentRange('bytes 10-9/100')).toBeNull();
    expect(parseByteContentRange('bytes 0-100/100')).toBeNull();
  });
});
