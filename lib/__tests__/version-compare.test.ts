import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  hasUpdate,
  normalizeVersion,
} from '@/lib/version-compare';

describe('parseVersion', () => {
  it('keeps every numeric release segment', () => {
    expect(parseVersion('1.2.3.4').segments).toEqual([1, 2, 3, 4]);
    expect(parseVersion('v7.0.15.4').segments).toEqual([7, 0, 15, 4]);
  });

  it('still exposes major/minor/patch for existing callers', () => {
    const v = parseVersion('24.100.1.5');
    expect(v.major).toBe(24);
    expect(v.minor).toBe(100);
    expect(v.patch).toBe(1);
  });

  it('separates prerelease from the release segments', () => {
    const v = parseVersion('1.2.3-beta.1');
    expect(v.segments).toEqual([1, 2, 3]);
    expect(v.prerelease).toBe('beta.1');
  });
});

describe('compareVersions', () => {
  it('detects a difference in the 4th segment (regression guard)', () => {
    expect(compareVersions('1.2.3.4', '1.2.3.9')).toBe(-1);
    expect(compareVersions('1.2.3.9', '1.2.3.4')).toBe(1);
    expect(compareVersions('7.0.15.4', '7.0.15.4')).toBe(0);
  });

  it('treats a missing trailing segment as zero', () => {
    expect(compareVersions('1.2.3', '1.2.3.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.3.1')).toBe(-1);
  });

  it('compares 3-segment versions as before', () => {
    expect(compareVersions('1.2.3', '1.3.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('ranks a release above its prerelease', () => {
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBe(1);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
  });

  it('handles date-style versions', () => {
    expect(compareVersions('2024.09.10', '2024.10.01')).toBe(-1);
  });
});

describe('hasUpdate', () => {
  it('flags a newer 4-segment build (the core update-detection case)', () => {
    expect(hasUpdate('1.2.3.4', '1.2.3.9')).toBe(true);
    expect(hasUpdate('1.2.3.9', '1.2.3.4')).toBe(false);
    expect(hasUpdate('1.2.3.4', '1.2.3.4')).toBe(false);
  });
});

describe('normalizeVersion', () => {
  it('pads short versions to three segments', () => {
    expect(normalizeVersion('1.2')).toBe('1.2.0');
    expect(normalizeVersion(null)).toBe('0.0.0');
  });
});
