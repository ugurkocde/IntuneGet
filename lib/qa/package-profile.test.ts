import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import {
  buildQaPackageIdentity,
  buildQaPackageIdentityFromWorkflowInput,
  canonicalQaJson,
  normalizeQaWorkflowPackageInput,
  QA_COMPATIBLE_PASSED_PACKAGER_COMMITS,
  QA_PACKAGE_PROFILE_SCHEMA_VERSION,
  QA_PSADT_TOOLCHAIN,
  qaSha256,
  splitQaPsadtConfig,
  validateCompatiblePassedCatalogQaProfile,
  validateCompatiblePassedDeploymentQaProfile,
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

  it('reuses execution QA when only presentation changes', () => {
    const deploymentInput = { ...input, profileKind: 'deployment-config' as const };
    const baseline = buildQaPackageIdentity(deploymentInput);
    const branded = buildQaPackageIdentity({
      ...deploymentInput,
      displayName: 'Customer-facing Example',
      publisher: 'Customer Publisher',
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        brandingCompanyName: 'Contoso',
        brandingWelcomeTitle: 'Install Example',
        brandingAccentColor: '#123456',
        progressDialog: {
          ...DEFAULT_PSADT_CONFIG.progressDialog,
          statusMessage: 'A customer-specific message',
          windowLocation: 'BottomRight',
        },
      },
    });

    expect(branded.executionProfileSha256).toBe(baseline.executionProfileSha256);
    expect(branded.packageProfileSha256).toBe(baseline.packageProfileSha256);
    expect(branded.presentationProfileSha256).not.toBe(
      baseline.presentationProfileSha256
    );
  });

  it('keeps interaction timing and custom command changes in the execution profile', () => {
    const baseline = buildQaPackageIdentity(input);
    const interactive = buildQaPackageIdentity({
      ...input,
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        allowDefer: true,
        deferTimes: 5,
        postInstallCommands: ['echo verified'],
      },
    });

    expect(interactive.executionProfileSha256).not.toBe(
      baseline.executionProfileSha256
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

  it('hashes manifest-declared success exit codes without changing empty profiles', () => {
    const baseline = buildQaPackageIdentity(input);
    const withSuccessCode = buildQaPackageIdentity({ ...input, successCodes: [1168] });
    expect(withSuccessCode.packageProfileSha256).not.toBe(baseline.packageProfileSha256);
    expect(withSuccessCode.profile.installer).toMatchObject({ successCodes: [1168] });
    expect(buildQaPackageIdentity({ ...input, successCodes: [] })).toEqual(baseline);
  });

  it('reconciles an IntuneGet marker with the current workflow scope and version', () => {
    const workflowInput = {
      wingetId: 'Asana.Asana',
      displayName: 'Asana',
      publisher: 'Asana',
      version: '2.8.0',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'exe',
      silentSwitches: '--silent',
      uninstallCommand: 'REGISTRY_UNINSTALL:Asana',
      installScope: 'user' as const,
      detectionRules: JSON.stringify([
        {
          type: 'registry',
          keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
          valueName: 'Version',
          detectionType: 'version',
          operator: 'greaterThanOrEqual',
          detectionValue: '2.7.1',
        },
      ]),
      psadtConfig: JSON.stringify({
        detectionRules: [],
        brandingCompanyName: 'Contoso',
      }),
    };
    const normalized = normalizeQaWorkflowPackageInput(workflowInput);
    const identity = buildQaPackageIdentityFromWorkflowInput(workflowInput);
    const profile = identity.profile as {
      schemaVersion: number;
      detectionRules: Array<Record<string, unknown>>;
      psadtConfig: { detectionRules: Array<Record<string, unknown>> };
    };

    expect(profile.schemaVersion).toBe(QA_PACKAGE_PROFILE_SCHEMA_VERSION);
    expect(profile.detectionRules[0]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
      detectionValue: '2.8.0',
    });
    expect(profile.psadtConfig.detectionRules).toEqual(profile.detectionRules);
    expect(JSON.parse(normalized.psadtConfigJson)).toMatchObject({
      brandingCompanyName: 'Contoso',
      detectionRules: profile.detectionRules,
    });
    expect(
      splitQaPsadtConfig(JSON.parse(normalized.psadtConfigJson)).execution
    ).toEqual(profile.psadtConfig);
  });

  it('repairs a legacy deployment profile that has no detection rules', () => {
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Anysphere.Cursor',
      displayName: 'Cursor',
      publisher: 'Anysphere',
      version: '3.14.27',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'inno',
      silentSwitches: '/VERYSILENT',
      uninstallCommand: 'REGISTRY_UNINSTALL:Cursor',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [] }),
    });

    expect(normalized.detectionRules).toEqual([
      expect.objectContaining({
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Anysphere_Cursor',
        detectionValue: '3.14.27',
      }),
    ]);
    expect(JSON.parse(normalized.psadtConfigJson).detectionRules).toEqual(
      normalized.detectionRules
    );
  });

  it('preserves PSADT detection rules when the top-level workflow list is empty', () => {
    const fileRule = {
      type: 'file' as const,
      path: '%ProgramFiles%\\Cursor',
      fileOrFolderName: 'Cursor.exe',
      detectionType: 'exists' as const,
    };
    const normalized = normalizeQaWorkflowPackageInput({
      wingetId: 'Anysphere.Cursor',
      displayName: 'Cursor',
      publisher: 'Anysphere',
      version: '3.14.27',
      architecture: 'x64',
      installerSha256: 'b'.repeat(64),
      installerType: 'inno',
      silentSwitches: '/VERYSILENT',
      uninstallCommand: 'REGISTRY_UNINSTALL:Cursor',
      installScope: 'machine',
      detectionRules: '[]',
      psadtConfig: JSON.stringify({ detectionRules: [fileRule] }),
    });

    expect(normalized.detectionRules).toEqual([fileRule]);
    expect(JSON.parse(normalized.psadtConfigJson).detectionRules).toEqual([fileRule]);
  });
});

describe('current catalog QA package validation', () => {
  function candidateFromIdentity(identity: ReturnType<typeof buildQaPackageIdentity>) {
    const profile = identity.profile as {
      app: { wingetId: string; version: string; architecture: string };
      installer: { sha256: string };
    };
    return {
      testConfig: {
        profileKind: 'catalog-default',
        packageProfileCanonicalJson: identity.canonicalJson,
        packageProfileSha256: identity.packageProfileSha256,
      },
      candidatePackageProfileSha256: identity.packageProfileSha256,
      candidateWingetId: profile.app.wingetId,
      candidateVersion: profile.app.version,
      candidateArchitecture: profile.app.architecture,
      candidateInstallerSha256: profile.installer.sha256,
    };
  }

  function identityWithPackagerCommit(
    identity: ReturnType<typeof buildQaPackageIdentity>,
    packagerCommit: string
  ) {
    const profile = {
      ...identity.profile,
      toolchain: { ...QA_PSADT_TOOLCHAIN, packagerCommit },
    };
    const canonicalJson = canonicalQaJson(profile);
    const packageProfileSha256 = qaSha256(canonicalJson);
    return { ...identity, profile, canonicalJson, packageProfileSha256 };
  }

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

  it('reuses an older catalog pass only when lifecycle behavior is unaffected', () => {
    const priorCommit = QA_COMPATIBLE_PASSED_PACKAGER_COMMITS.find(
      (commit) => commit !== QA_PSADT_TOOLCHAIN.packagerCommit
    );
    expect(priorCommit).toBeTruthy();
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity(input),
      priorCommit!
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toMatchObject({ valid: true });
  });

  it('does not reuse a process lifecycle pass from before the lifecycle release', () => {
    const priorCommit = 'c1fe66c04b11f595bfaf4c9ca7cc1444186ea028';
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          processesToClose: [{ name: 'Example', description: 'Example' }],
        },
      }),
      priorCommit
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({ valid: false, reason: 'compatible-process-lifecycle-changed' });
  });

  it('reuses a process lifecycle pass through later unrelated releases', () => {
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          processesToClose: [{ name: 'Example', description: 'Example' }],
        },
      }),
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toMatchObject({ valid: true });
  });

  it('retests only a profile that exercises the zero-day deferral branch', () => {
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          allowDefer: true,
          deferDays: 0,
        },
      }),
      '430f817da1120f6a14f421b7016b628a06854aba'
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({ valid: false, reason: 'compatible-zero-day-deferral-changed' });
  });

  it('reuses the same deployment execution profile across an unrelated packager release', () => {
    const currentIdentity = buildQaPackageIdentity({
      ...input,
      profileKind: 'deployment-config',
      psadtConfig: {
        ...DEFAULT_PSADT_CONFIG,
        processesToClose: [{ name: 'Example', description: 'Example' }],
      },
    });
    const priorIdentity = identityWithPackagerCommit(
      currentIdentity,
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );

    expect(validateCompatiblePassedDeploymentQaProfile({
      prior: {
        testConfig: {
          profileKind: 'deployment-config',
          packageProfileCanonicalJson: priorIdentity.canonicalJson,
          packageProfileSha256: priorIdentity.packageProfileSha256,
        },
        candidatePackageProfileSha256: priorIdentity.packageProfileSha256,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      },
      currentCanonicalJson: currentIdentity.canonicalJson,
      currentPackageProfileSha256: currentIdentity.packageProfileSha256,
    })).toMatchObject({ valid: true });
  });

  it('does not reuse a different deployment execution profile', () => {
    const currentIdentity = buildQaPackageIdentity({
      ...input,
      profileKind: 'deployment-config',
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, deployMode: 'Auto' },
    });
    const priorIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({ ...input, profileKind: 'deployment-config' }),
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );

    expect(validateCompatiblePassedDeploymentQaProfile({
      prior: {
        testConfig: {
          profileKind: 'deployment-config',
          packageProfileCanonicalJson: priorIdentity.canonicalJson,
          packageProfileSha256: priorIdentity.packageProfileSha256,
        },
        candidatePackageProfileSha256: priorIdentity.packageProfileSha256,
        candidateWingetId: input.wingetId,
        candidateVersion: input.version,
        candidateArchitecture: input.architecture,
        candidateInstallerSha256: input.installerSha256,
      },
      currentCanonicalJson: currentIdentity.canonicalJson,
      currentPackageProfileSha256: currentIdentity.packageProfileSha256,
    })).toEqual({ valid: false, reason: 'compatible-execution-profile-changed' });
  });

  it('does not reuse an older pass when the current app adapter adds behavior', () => {
    const priorCommit = QA_COMPATIBLE_PASSED_PACKAGER_COMMITS.find(
      (commit) => commit !== QA_PSADT_TOOLCHAIN.packagerCommit
    )!;
    const legacyIdentity = identityWithPackagerCommit(
      buildQaPackageIdentity({
        ...input,
        wingetId: 'Elgato.StreamDeck',
      }),
      priorCommit
    );

    expect(
      validateCompatiblePassedCatalogQaProfile(candidateFromIdentity(legacyIdentity))
    ).toEqual({ valid: false, reason: 'compatible-application-adapter-changed' });
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
