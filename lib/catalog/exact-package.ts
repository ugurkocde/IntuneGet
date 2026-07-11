import type { NormalizedPackage } from '@/types/winget';

export function findExactCatalogPackage(
  packages: NormalizedPackage[],
  packageId: string,
): NormalizedPackage | null {
  return packages.find((pkg) => pkg.id === packageId) ?? null;
}
