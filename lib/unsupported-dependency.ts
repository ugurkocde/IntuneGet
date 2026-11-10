import type { PackageCompatibilityBlock } from './package-eligibility';

export function unsupportedDependencyMessage(block: Pick<PackageCompatibilityBlock, 'code' | 'detail'> | null) {
  if (block?.code !== 'unreviewed_dependency') return null;
  const match = /^WinGet dependency (\S+) is not in the reviewed redistribution allowlist\.$/.exec(block.detail);
  const identifier = match?.[1];
  const valid = match?.[0] === block.detail && identifier && identifier.length <= 128
    && /^(?:[A-Za-z0-9][A-Za-z0-9+_-]{0,31}\.){1,7}[A-Za-z0-9][A-Za-z0-9+_-]{0,31}$/.test(identifier);
  return valid
    ? `This app requires ${identifier}, which is not supported yet. Automated deployment is blocked.`
    : 'This app requires a dependency that is not supported yet. Automated deployment is blocked.';
}
