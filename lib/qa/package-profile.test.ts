import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { buildQaPackageIdentity, canonicalQaJson } from './package-profile';

const input = {
  profileKind: 'catalog-default' as const,
  wingetId: 'Example.App',
  displayName: 'Example',
  publisher: 'Example Corp',
  version: '2.0.0',
  architecture: 'x64',
  installerSha256: 'a'.repeat(64),
  sourceInstallerType: 'inno',
  silentArgs: '/VERYSILENT',
  uninstallCommand: 'REGISTRY_UNINSTALL:Example',
  installScope: 'machine',
  nestedInstallerType: '',
  nestedInstallerFiles: [],
  psadtConfig: DEFAULT_PSADT_CONFIG,
  detectionRules: [],
};

describe('PSADT QA package identity', () => {
  it('canonicalizes object keys recursively', () => {
    expect(canonicalQaJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}'
    );
  });

  it('is stable for the same effective package inputs', () => {
    expect(buildQaPackageIdentity(input)).toEqual(buildQaPackageIdentity({ ...input }));
  });

  it('changes when a PSADT switch changes', () => {
    const changed = buildQaPackageIdentity({
      ...input,
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, verifyInstall: true },
    });
    expect(changed.packageProfileSha256).not.toBe(
      buildQaPackageIdentity(input).packageProfileSha256
    );
    expect(changed.psadtConfigSha256).not.toBe(
      buildQaPackageIdentity(input).psadtConfigSha256
    );
  });

  it('changes when installer switches or detection rules change', () => {
    expect(
      buildQaPackageIdentity({ ...input, silentArgs: '/S' }).packageProfileSha256
    ).not.toBe(buildQaPackageIdentity(input).packageProfileSha256);
    expect(
      buildQaPackageIdentity({
        ...input,
        detectionRules: [
          {
            type: 'registry',
            keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Example',
            check32BitOn64System: false,
            detectionType: 'exists',
          },
        ],
      }).packageProfileSha256
    ).not.toBe(buildQaPackageIdentity(input).packageProfileSha256);
  });

  it('binds canonical-vs-deployment routing into the profile identity', () => {
    expect(
      buildQaPackageIdentity({ ...input, profileKind: 'deployment-config' })
        .packageProfileSha256
    ).not.toBe(buildQaPackageIdentity(input).packageProfileSha256);
  });
});
