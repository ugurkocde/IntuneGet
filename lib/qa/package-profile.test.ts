import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import {
  buildQaPackageIdentity,
  canonicalQaJson,
  QA_PACKAGE_PROFILE_SCHEMA_VERSION,
  QA_PSADT_TOOLCHAIN,
  qaSha256,
  validateCurrentQaPackageProfile,
} from './package-profile';

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

describe('current catalog QA package validation', () => {
  function currentCandidate() {
    const identity = buildQaPackageIdentity(input);
    return {
      testConfig: {
        profileKind: 'catalog-default',
        packageProfileCanonicalJson: identity.canonicalJson,
        packageProfileSha256: identity.packageProfileSha256,
      },
      candidatePackageProfileSha256: identity.packageProfileSha256,
      candidateWingetId: input.wingetId,
      candidateVersion: input.version,
      candidateArchitecture: input.architecture,
      candidateInstallerSha256: input.installerSha256,
    };
  }

  it('accepts a fully current profile identity', () => {
    expect(validateCurrentQaPackageProfile(currentCandidate())).toMatchObject({
      valid: true,
    });
  });

  it('normalizes case and whitespace on both sides of candidate bindings', () => {
    const identity = buildQaPackageIdentity(input);
    const profile = identity.profile as {
      app: Record<string, unknown>;
      installer: Record<string, unknown>;
    };
    const normalizedProfile = {
      ...profile,
      app: {
        ...profile.app,
        wingetId: ` ${input.wingetId.toUpperCase()} `,
        version: ` ${input.version} `,
        architecture: 'X64',
      },
      installer: {
        ...profile.installer,
        sha256: input.installerSha256.toLowerCase(),
      },
    };
    const canonicalJson = canonicalQaJson(normalizedProfile);
    const hash = qaSha256(canonicalJson);

    expect(
      validateCurrentQaPackageProfile({
        ...currentCandidate(),
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: canonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash.toLowerCase(),
        candidateWingetId: ` ${input.wingetId.toLowerCase()} `,
        candidateVersion: ` ${input.version} `,
        candidateArchitecture: ' x64 ',
        candidateInstallerSha256: ` ${input.installerSha256.toLowerCase()} `,
      })
    ).toMatchObject({ valid: true });
  });

  it('hashes the stored JSON bytes without re-serializing them', () => {
    const identity = buildQaPackageIdentity(input);
    const nonCanonicalJson = JSON.stringify(identity.profile);
    const hash = qaSha256(nonCanonicalJson);
    expect(
      validateCurrentQaPackageProfile({
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: nonCanonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      })
    ).toMatchObject({ valid: true, packageProfileSha256: hash });
  });

  it.each([
    ['profileKind', 'wrong-profile-kind'],
    ['packageProfileCanonicalJson', 'canonical-json-missing'],
    ['packageProfileSha256', 'config-profile-sha-invalid'],
  ])('rejects an invalid %s', (field, reason) => {
    const candidate = currentCandidate();
    delete candidate.testConfig[field as keyof typeof candidate.testConfig];
    expect(validateCurrentQaPackageProfile(candidate)).toEqual({ valid: false, reason });
  });

  it('rejects malformed canonical JSON', () => {
    const candidate = currentCandidate();
    candidate.testConfig.packageProfileCanonicalJson = '{';
    expect(validateCurrentQaPackageProfile(candidate)).toEqual({
      valid: false,
      reason: 'canonical-json-invalid',
    });
  });

  it('rejects independent config and candidate hash mismatches', () => {
    const configMismatch = currentCandidate();
    configMismatch.testConfig.packageProfileSha256 = 'B'.repeat(64);
    expect(validateCurrentQaPackageProfile(configMismatch)).toEqual({
      valid: false,
      reason: 'config-profile-sha-mismatch',
    });

    const candidateMismatch = currentCandidate();
    candidateMismatch.candidatePackageProfileSha256 = 'B'.repeat(64);
    expect(validateCurrentQaPackageProfile(candidateMismatch)).toEqual({
      valid: false,
      reason: 'candidate-profile-sha-mismatch',
    });
  });

  it('accepts a current deployment-config profile', () => {
    const identity = buildQaPackageIdentity({ ...input, profileKind: 'deployment-config' });
    expect(
      validateCurrentQaPackageProfile({
        testConfig: {
          profileKind: 'deployment-config',
          packageProfileCanonicalJson: identity.canonicalJson,
          packageProfileSha256: identity.packageProfileSha256,
        },
        candidatePackageProfileSha256: identity.packageProfileSha256,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      })
    ).toMatchObject({ valid: true });
  });

  it('rejects a missing test config and an invalid candidate hash', () => {
    const candidate = currentCandidate();
    expect(
      validateCurrentQaPackageProfile({ ...candidate, testConfig: null })
    ).toEqual({ valid: false, reason: 'test-config-invalid' });
    expect(
      validateCurrentQaPackageProfile({
        ...candidate,
        candidatePackageProfileSha256: 'not-a-hash',
      })
    ).toEqual({ valid: false, reason: 'candidate-profile-sha-invalid' });
  });

  it.each([
    ['schemaVersion', QA_PACKAGE_PROFILE_SCHEMA_VERSION + 1, 'canonical-schema-version-mismatch'],
    ['testLevel', 'other', 'canonical-test-level-mismatch'],
    ['profileKind', 'deployment-config', 'canonical-profile-kind-mismatch'],
    ['toolchain', null, 'toolchain-missing'],
  ])('rejects canonical %s inconsistency', (field, value, reason) => {
    const identity = buildQaPackageIdentity(input);
    const profile = { ...identity.profile, [field]: value };
    const canonicalJson = canonicalQaJson(profile);
    const hash = qaSha256(canonicalJson);
    expect(
      validateCurrentQaPackageProfile({
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: canonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      })
    ).toEqual({ valid: false, reason });
  });

  it.each([
    ['candidateWingetId', 'Different.App', 'candidate-winget-id-mismatch'],
    ['candidateVersion', '9.9.9', 'candidate-version-mismatch'],
    ['candidateArchitecture', 'x86', 'candidate-architecture-mismatch'],
    ['candidateInstallerSha256', 'B'.repeat(64), 'candidate-installer-sha-mismatch'],
  ])('binds %s to the canonical profile', (field, value, reason) => {
    const candidate = currentCandidate();
    candidate[field as keyof typeof candidate] = value as never;
    expect(validateCurrentQaPackageProfile(candidate)).toEqual({ valid: false, reason });
  });

  it.each(Object.keys(QA_PSADT_TOOLCHAIN))(
    'rejects a mismatch in toolchain field %s',
    (field) => {
      const identity = buildQaPackageIdentity(input);
      const profile = {
        ...identity.profile,
        toolchain: {
          ...QA_PSADT_TOOLCHAIN,
          [field]: 'stale-value',
        },
      };
      const canonicalJson = canonicalQaJson(profile);
      const hash = qaSha256(canonicalJson);
      expect(
        validateCurrentQaPackageProfile({
          testConfig: {
            profileKind: 'catalog-default',
            packageProfileCanonicalJson: canonicalJson,
            packageProfileSha256: hash,
          },
          candidatePackageProfileSha256: hash,
          candidateWingetId: input.wingetId,
          candidateVersion: input.version,
          candidateArchitecture: input.architecture,
          candidateInstallerSha256: input.installerSha256,
        })
      ).toEqual({ valid: false, reason: `toolchain-mismatch:${field}` });
    }
  );

  it.each([
    ['psadtConfigSha256', 'canonical-psadt-config-sha-mismatch'],
    ['detectionRulesSha256', 'canonical-detection-rules-sha-mismatch'],
  ])('rejects an inconsistent embedded %s', (field, reason) => {
    const identity = buildQaPackageIdentity(input);
    const profile = { ...identity.profile, [field]: 'B'.repeat(64) };
    const canonicalJson = canonicalQaJson(profile);
    const hash = qaSha256(canonicalJson);

    expect(
      validateCurrentQaPackageProfile({
        ...currentCandidate(),
        testConfig: {
          profileKind: 'catalog-default',
          packageProfileCanonicalJson: canonicalJson,
          packageProfileSha256: hash,
        },
        candidatePackageProfileSha256: hash,
      })
    ).toEqual({ valid: false, reason });
  });
});
