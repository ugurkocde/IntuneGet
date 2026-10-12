import { compareVersions } from '@/lib/version-compare';

export type QaVersionMismatchKind = 'catalog-older' | 'catalog-newer' | 'equivalent-identifiers';

export function qaVersionMismatchKind(testedVersion: string, catalogVersion: string): QaVersionMismatchKind {
  const catalogComparedWithTested = compareVersions(catalogVersion, testedVersion);
  if (catalogComparedWithTested < 0) return 'catalog-older';
  if (catalogComparedWithTested > 0) return 'catalog-newer';
  return 'equivalent-identifiers';
}

export function qaVersionMismatchMessage(testedVersion: string, catalogVersion: string): string {
  const mismatchKind = qaVersionMismatchKind(testedVersion, catalogVersion);

  if (mismatchKind === 'catalog-older') {
    return `This QA result is for version ${testedVersion}; the catalog still offers the older version ${catalogVersion}. The newer tested version has not been promoted to the catalog.`;
  }
  if (mismatchKind === 'catalog-newer') {
    return `This QA result is for version ${testedVersion}; the catalog now offers the newer version ${catalogVersion}. The outcome may not apply to that version.`;
  }
  return `This QA result is for version ${testedVersion}; the catalog version is ${catalogVersion}. The identifiers differ, so QA applies only to the exact tested version.`;
}
