import { describe, expect, it } from 'vitest';
import type { NormalizedPackage } from '@/types/winget';
import { findExactCatalogPackage } from './exact-package';

const packages: NormalizedPackage[] = [
  {
    id: 'Google.Chrome',
    name: 'Google Chrome',
    publisher: 'Google',
    version: '1.0',
    appSource: 'win32',
  },
  {
    id: '9WZDNCRFJ3PZ',
    name: 'Company Portal',
    publisher: 'Microsoft Corporation',
    version: '1.0',
    appSource: 'store',
    packageIdentifier: '9WZDNCRFJ3PZ',
  },
];

describe('findExactCatalogPackage', () => {
  it('returns the exact Win32 catalog entry', () => {
    expect(findExactCatalogPackage(packages, 'Google.Chrome')).toBe(packages[0]);
  });

  it('preserves Microsoft Store metadata', () => {
    expect(findExactCatalogPackage(packages, '9WZDNCRFJ3PZ')).toEqual(
      expect.objectContaining({
        appSource: 'store',
        packageIdentifier: '9WZDNCRFJ3PZ',
      }),
    );
  });

  it('never substitutes a fuzzy or differently-cased result', () => {
    expect(findExactCatalogPackage(packages, 'Chrome')).toBeNull();
    expect(findExactCatalogPackage(packages, 'google.chrome')).toBeNull();
  });

  it('returns null for an empty package list', () => {
    expect(findExactCatalogPackage([], 'Google.Chrome')).toBeNull();
  });

  it('returns null for an empty package id', () => {
    expect(findExactCatalogPackage(packages, '')).toBeNull();
  });

  it('returns the first entry when the list contains duplicate ids', () => {
    const duplicate: NormalizedPackage = { ...packages[0], name: 'Chrome (copy)' };
    expect(findExactCatalogPackage([...packages, duplicate], 'Google.Chrome')).toBe(
      packages[0],
    );
  });
});
