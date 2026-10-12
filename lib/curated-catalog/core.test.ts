import { describe, expect, it } from 'vitest';
import committed from '@/catalog/curated/catalog.json';
import committedKeys from '@/catalog/curated/trusted-keys.json';
import { CURATED_APPS } from './definitions';
import { assertInstallerSource, canonicalJson, catalogEntries, compareReleaseVersions,
  createCandidate, signCatalog, validateDefinitions, validateRelease, verifyCatalog, verifyCatalogReleases, verifyCatalogSignature } from './core.mjs';
import { releaseFixture, signedFixture } from './test-fixtures';

describe('curated approval trust boundary', () => {
  it('accepts reviewed Burn bundles and rejects unknown installer engines', () => {
    const app = CURATED_APPS.find(item => item.id === 'python-314')!;
    expect(validateDefinitions([{ ...app, installerType: 'burn' }])).toHaveLength(1);
    expect(() => validateDefinitions([{ ...app, installerType: 'unknown' }])).toThrow(/unattended installer contract/);
  });
  it('opts Python into its reviewed LocalSystem bundle registration without changing machine install identity', () => {
    const app = CURATED_APPS.find(item => item.id === 'python-314')!;
    expect(app.installedIdentity).toMatchObject({ registrationScope: 'machine-and-localsystem-user', versionFormat: 'python-msi' });
    expect(app.scope).toBe('machine');
    expect(app.architecture).toBe('x64');
    expect(app.installedIdentity.executablePaths).toEqual(['Python314/python.exe']);
    expect(validateDefinitions([app])).toHaveLength(1);
  });
  it('rejects arbitrary registry scopes and binds the reviewed scope into signed definitions', () => {
    const app = CURATED_APPS.find(item => item.id === 'python-314')!;
    for (const registrationScope of [null, '', 'HKCU', 'machine', 'S-1-5-21', 'Machine-and-localsystem-user']) {
      expect(() => validateDefinitions([{ ...app, installedIdentity: { ...app.installedIdentity, registrationScope } }])).toThrow(/registration scope/);
    }
    const { envelope, keys } = signedFixture();
    const changed = structuredClone(CURATED_APPS);
    delete changed.find(item => item.id === 'python-314')!.installedIdentity.registrationScope;
    expect(() => verifyCatalog(envelope, changed, keys)).toThrow(/definitions/);
  });
  it('limits reviewed removal arguments to distinct switches for an exact EXE registration', () => {
    const app = CURATED_APPS.find(app => app.id === 'winrar')!;
    expect(validateDefinitions([app])).toHaveLength(1);
    for (const args of [null, '/s', [], ['/s', '/S'], [' /s'], ['/s & whoami'], ['/s\n'], ['C:\\uninstall.exe'], ['/' + 's'.repeat(65)], Array(21).fill('/s')]) {
      expect(() => validateDefinitions([{ ...app, reviewedUninstallArguments: args } as typeof app])).toThrow(/Reviewed uninstall arguments/);
    }
    expect(() => validateDefinitions([{ ...app, registeredUninstall: undefined }])).toThrow(/exact EXE registration/);
    expect(() => validateDefinitions([{ ...app, installerType: 'msi' }])).toThrow(/exact EXE registration/);
  });
  it('defines fifty applications and commits only a catalog signed by a committed trust key', () => {
    expect(validateDefinitions(CURATED_APPS)).toHaveLength(50);
    // The automation re-signs after definition changes and before expiry, so
    // only the signer is checked here; deployment checks expiry and digest.
    const payload = verifyCatalogSignature(committed, committedKeys);
    if (committed.signature === null) expect(payload.releases).toHaveLength(0);
    else expect(() => verifyCatalogSignature(committed, {})).toThrow(/not trusted/);
  });
  it('authenticates the signer for re-signing without checking expiry or the definitions digest', () => {
    const { envelope, keys } = signedFixture();
    const changed = CURATED_APPS.map(app => ({ ...app, notes: `${app.notes} Changed.` }));
    expect(() => verifyCatalog(envelope, changed, keys)).toThrow(/definitions/);
    expect(verifyCatalogSignature(envelope, keys).releases).toHaveLength(1);
    expect(() => verifyCatalogSignature({ ...envelope, payload: { ...envelope.payload, withdrawnReleaseIds: ['x'] } }, keys)).toThrow(/signature is invalid/);
    expect(() => verifyCatalogSignature(envelope, {})).toThrow(/not trusted/);
  });
  it('requires a reviewed unsigned exception reason exactly when unsigned installers are allowed', () => {
    const sevenZip = CURATED_APPS.find(app => app.id === '7zip')!;
    const { unsignedExceptionReason, ...withoutReason } = sevenZip;
    expect(unsignedExceptionReason!.length).toBeGreaterThanOrEqual(20);
    expect(() => validateDefinitions([withoutReason])).toThrow(/unsigned/);
    expect(() => validateDefinitions([{ ...CURATED_APPS[0], unsignedExceptionReason: 'Not allowed for signed apps.' }])).toThrow(/unsigned/);
  });
  it('accepts an independently signed catalog with complete evidence', () => {
    const { envelope, keys } = signedFixture();
    expect(verifyCatalog(envelope, CURATED_APPS, keys).releases).toHaveLength(1);
  });
  it('requires a reviewed version comparison with at least three components', () => {
    const app = CURATED_APPS.find(item => item.id === 'audacity')!;
    expect(validateDefinitions([app])).toHaveLength(1);
    expect(() => validateDefinitions([{ ...app, installedIdentity: { ...app.installedIdentity, versionComponents: 2 } }])).toThrow(/three release components/);
  });
  it('rejects an untrusted signing key and signed payload tampering', () => {
    const { envelope, keys } = signedFixture();
    expect(() => verifyCatalog(envelope, CURATED_APPS, {})).toThrow(/not trusted/);
    envelope.payload.releases[0].installerSha256 = 'b'.repeat(64);
    expect(() => verifyCatalog(envelope, CURATED_APPS, keys)).toThrow(/signature/);
  });
  it('binds approval to the reviewed definitions', () => {
    const { envelope, keys } = signedFixture();
    const changed = structuredClone(CURATED_APPS);
    changed[0].silentArgs += ' UNKNOWN=YES';
    expect(() => verifyCatalog(envelope, changed, keys)).toThrow(/definitions/);
  });
  it('expires approvals at their validity boundary', () => {
    const { envelope, keys } = signedFixture();
    expect(() => verifyCatalog(envelope, CURATED_APPS, keys, new Date(envelope.payload.expiresAt!))).toThrow(/expired/);
  });
  it('requires a short catalog lifetime', () => {
    const fixture = signedFixture();
    fixture.envelope.payload.expiresAt = new Date(Date.now() + 8 * 86_400_000).toISOString();
    expect(() => signCatalog(fixture.envelope.payload, CURATED_APPS, 'unit-test', fixture.privatePem)).toThrow(/validity/);
  });
  it.each(['install', 'detectionAfterInstall', 'upgrade', 'detectionAfterUpgrade', 'uninstall', 'detectionAfterUninstall'] as const)('requires the %s phase to pass', phase => {
    const release = releaseFixture();
    release.evidence.qa.phases[phase]!.passed = false;
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/all pass/);
  });
  it.each(['installer', 'security', 'qa', 'profile'] as const)('binds %s evidence to the exact artifact', kind => {
    const release = releaseFixture();
    if (kind === 'installer') release.evidence.installerSha256 = 'b'.repeat(64);
    if (kind === 'security') release.evidence.security.installerSha256 = 'b'.repeat(64);
    if (kind === 'qa') release.evidence.qa.installerSha256 = 'b'.repeat(64);
    if (kind === 'profile') release.evidence.qa.executionProfileSha256 = 'b'.repeat(64);
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/different installer|different installer or execution/);
  });
  it('blocks malware flags, missing signature evidence, and self approval', () => {
    const release = releaseFixture();
    release.evidence.security.suspicious = 1;
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/malware/);
    release.evidence.security.suspicious = 0;
    const observed = release.evidence.signature;
    release.evidence.signature = { status: 'forged', publisher: null } as unknown as typeof observed;
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/signature evidence/);
    release.evidence.signature = observed;
    release.approvedBy = release.preparedBy.toUpperCase();
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/different reviewers/);
  });
  it('records the observed signature without gating on the signer, because the SHA256 pin is the trust anchor', () => {
    for (const signature of [{ status: 'valid', publisher: 'A renamed certificate subject' }, { status: 'unsigned', publisher: null }, { status: 'untrusted', publisher: 'Self-signed publisher' }] as const) {
      const release = releaseFixture();
      release.evidence.signature = { ...signature };
      expect(validateRelease(CURATED_APPS[0], release)).toBeTruthy();
    }
    const release = releaseFixture();
    release.evidence.installerSha256 = 'b'.repeat(64);
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/different installer/);
  });
  it('requires fresh evidence after discovery and a genuinely older upgrade source', () => {
    const release = releaseFixture();
    release.evidence.qa.testedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/recent evidence/);
    release.evidence.qa.testedAt = release.evidence.verifiedAt;
    release.evidence.qa.upgradeFromVersion = release.candidate.version;
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/earlier version/);
  });
  describe('vendor-managed upgrade exemption', () => {
    const reason = 'Google publishes no historical enterprise MSI for Chrome.';
    const skipped = (app = CURATED_APPS[0]) => {
      const release = releaseFixture(app);
      const { upgrade, detectionAfterUpgrade, ...phases } = release.evidence.qa.phases;
      void upgrade; void detectionAfterUpgrade;
      delete release.evidence.qa.upgradeFromVersion;
      release.evidence.qa.phases = phases;
      release.evidence.qa.upgrade = { tested: false, reason };
      return release;
    };
    it('accepts a skipped upgrade only for a vendor-managed app with a reviewed reason', () => {
      expect(CURATED_APPS[0].autoUpdate).toBe('vendor-managed');
      expect(validateRelease(CURATED_APPS[0], skipped()).evidence.qa.upgrade).toEqual({ tested: false, reason });
      const { envelope, keys } = signedFixture([skipped()]);
      expect(verifyCatalog(envelope, CURATED_APPS, keys).releases[0].evidence.qa.upgrade?.tested).toBe(false);
    });
    it.each(['7zip', 'git', 'putty'])('rejects a skipped upgrade for the self-contained %s release', id => {
      const app = CURATED_APPS.find(app => app.id === id)!;
      expect(app.autoUpdate).toBe('none');
      expect(() => validateRelease(app, skipped(app))).toThrow(/vendor-managed/);
    });
    it('rejects a missing, short or malformed exemption', () => {
      for (const upgrade of [{ tested: false, reason: 'too short' }, { tested: false, reason: ' '.repeat(30) }, { tested: false }, { tested: true, reason },
        { tested: false, reason, upgradeFromVersion: '1.0' }, null]) {
        const release = skipped(); (release.evidence.qa as Record<string, unknown>).upgrade = upgrade;
        expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/exemption reason/);
      }
    });
    it('rejects a skipped upgrade that also claims upgrade evidence', () => {
      for (const mutate of [
        (release: ReturnType<typeof skipped>) => { release.evidence.qa.upgradeFromVersion = '1.0'; },
        (release: ReturnType<typeof skipped>) => { release.evidence.qa.phases.upgrade = { passed: true }; },
        (release: ReturnType<typeof skipped>) => { release.evidence.qa.phases.detectionAfterUpgrade = { passed: false }; },
        (release: ReturnType<typeof skipped>) => { (release.evidence.qa as Record<string, unknown>).previousInstallerSha256 = 'a'.repeat(64); },
      ]) {
        const release = skipped(); mutate(release);
        expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/cannot carry upgrade evidence/);
      }
    });
    it.each(['install', 'detectionAfterInstall', 'uninstall', 'detectionAfterUninstall'] as const)('still requires the %s phase when the upgrade is skipped', phase => {
      const release = skipped(); release.evidence.qa.phases[phase].passed = false;
      expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/all pass/);
    });
    it('still requires both upgrade phases when no exemption is recorded', () => {
      const release = skipped(); delete release.evidence.qa.upgrade; release.evidence.qa.upgradeFromVersion = '1.0';
      expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/all pass/);
    });
  });
  it('requires a reviewed vendor auto-update policy in every definition', () => {
    expect(() => validateDefinitions([{ ...structuredClone(CURATED_APPS[0]), autoUpdate: 'unknown' } as never])).toThrow(/auto-update/);
  });
  it('selects numeric latest versions and excludes withdrawn releases', () => {
    const old = releaseFixture(CURATED_APPS[0], '9.0');
    const latest = releaseFixture(CURATED_APPS[0], '120.0');
    const fixture = signedFixture([old, latest], [latest.id]);
    const entries = catalogEntries(CURATED_APPS, verifyCatalog(fixture.envelope, CURATED_APPS, fixture.keys));
    expect(entries[0].release?.id).toBe(old.id);
    expect(compareReleaseVersions('9.0', '120.0')).toBe(-1);
  });
  it.each([
    'http://dl.google.com/dl/chrome/install/test.msi',
    'https://dl.google.com.evil.test/dl/chrome/install/test.msi',
    'https://evil.test/dl/chrome/install/test.msi',
    'https://user@dl.google.com/dl/chrome/install/test.msi',
    'https://dl.google.com/dl/chrome/installers/test.msi',
    'https://dl.google.com/dl/chrome/install/test.zip',
    'https://dl.google.com/dl/chrome/install/a%2fb.msi',
  ])('rejects installer source spoofing: %s', url => {
    expect(() => assertInstallerSource(CURATED_APPS[0], url)).toThrow();
  });
  it('accepts x86 and x64 machine definitions only', () => {
    const app = (id: string) => structuredClone(CURATED_APPS.find(app => app.id === id)!);
    expect(app('winscp').architecture).toBe('x86');
    expect(() => validateDefinitions([{ ...app('winscp'), architecture: 'arm64' }])).toThrow(/x64 or x86/);
  });
  it('validates mirror redirect opt-ins and publisher checksum sources', () => {
    const vlc = () => structuredClone(CURATED_APPS.find(app => app.id === 'vlc')!);
    expect(vlc().installerRedirectPolicy).toBe('any-https-mirror-with-pinned-sha256');
    expect(() => validateDefinitions([{ ...vlc(), installerRedirectPolicy: 'any-mirror' } as never])).toThrow(/redirect policy/);
    expect(() => validateDefinitions([{ ...vlc(), checksumSource: undefined }])).toThrow(/checksum source/);
    for (const urlTemplate of ['https://checksums.example/{version}.sha256', 'https://downloads.videolan.org/pub/videolan/vlc/{version}/win64/vlc-{version}-win64.exe',
      'http://downloads.videolan.org/pub/videolan/vlc/{version}/SHA256SUMS', 'https://downloads.videolan.org/pub/{version}/sums?file=x',
      'https://downloads.videolan.org/other/{version}/vlc.sha256']) {
      expect(() => validateDefinitions([{ ...vlc(), checksumSource: { ...vlc().checksumSource!, urlTemplate } }])).toThrow();
    }
    for (const entryTemplate of ['../vlc-{version}-win64.exe', '/vlc-{version}-win64.exe', 'vlc-{version}-win64.sha256']) {
      expect(() => validateDefinitions([{ ...vlc(), checksumSource: { ...vlc().checksumSource!, entryTemplate } }])).toThrow(/relative installer/);
    }
  });
  it('requires a publisher SHA256 for apps that accept any HTTPS mirror', () => {
    const vlc = CURATED_APPS.find(app => app.id === 'vlc')!;
    const installerUrl = 'https://downloads.videolan.org/pub/videolan/vlc/3.0.24/win64/vlc-3.0.24-win64.exe';
    expect(() => createCandidate(vlc, { version: '3.0.24', installerUrl })).toThrow(/SHA256 pin/);
    expect(createCandidate(vlc, { version: '3.0.24', installerUrl, vendorSha256: 'A'.repeat(64) }).vendorSha256).toBe('a'.repeat(64));
    expect(createCandidate(CURATED_APPS.find(app => app.id === 'putty')!, { version: '0.85', installerUrl: 'https://the.earth.li/~sgtatham/putty/0.85/w64/putty-64bit-0.85-installer.msi' }).vendorSha256).toBeNull();
  });
  it('rejects unknown versions and non-JSON signature inputs', () => {
    expect(() => createCandidate(CURATED_APPS[0], { version: 'latest', installerUrl: 'https://dl.google.com/dl/chrome/install/test.msi' })).toThrow(/numeric/);
    expect(() => canonicalJson({ hash: undefined })).toThrow();
    expect(() => canonicalJson({ score: NaN })).toThrow();
  });
});

describe('curated catalog serving across definition changes', () => {
  it('keeps a signed catalog servable after a definitions change, revalidating each release', () => {
    const { envelope, keys } = signedFixture();
    const changed = CURATED_APPS.map(app => ({ ...app, notes: `${app.notes} Changed.` }));
    const result = verifyCatalogReleases(envelope, changed, keys);
    expect(result.current).toBe(false);
    expect(result.payload.releases).toHaveLength(1);
    expect(verifyCatalogReleases(envelope, CURATED_APPS, keys).current).toBe(true);
    expect(() => verifyCatalogReleases(envelope, CURATED_APPS, {})).toThrow(/not trusted/);
    expect(() => verifyCatalogReleases(envelope, CURATED_APPS, keys, new Date(Date.now() + 2 * 86_400_000))).toThrow(/expired/);
  });
  it('drops only releases that no longer satisfy the current definitions', () => {
    const { envelope, keys } = signedFixture();
    const moved = CURATED_APPS.map(app => app.id === CURATED_APPS[0].id ? { ...app, allowedInstallerSources: [{ origin: 'https://example.com', pathPrefix: '/moved/' }] } : app);
    expect(verifyCatalogReleases(envelope, moved, keys).payload.releases).toHaveLength(0);
  });
  it('rejects registered uninstall identities that are unsafe or do not match the installed identity', () => {
    const vscode = CURATED_APPS.find(app => app.id === 'vscode')!;
    for (const registeredUninstall of [{ displayName: 'Microsoft Visual Studio Code', key: 'bad"key' }, { displayName: 'Something Else', key: 'Code_is1' }, { displayName: 'Microsoft Visual Studio Code' }]) {
      expect(() => validateDefinitions([{ ...vscode, registeredUninstall } as typeof vscode])).toThrow(/registered uninstall/);
    }
  });
});
