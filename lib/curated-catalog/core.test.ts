import { describe, expect, it } from 'vitest';
import bootstrap from '@/catalog/curated/catalog.json';
import { CURATED_APPS } from './definitions';
import { assertInstallerSource, canonicalJson, catalogEntries, compareReleaseVersions,
  createCandidate, signCatalog, validateDefinitions, validateRelease, verifyCatalog } from './core.mjs';
import { releaseFixture, signedFixture } from './test-fixtures';

describe('curated approval trust boundary', () => {
  it('starts with exactly ten pending applications and no release authority', () => {
    expect(validateDefinitions(CURATED_APPS)).toHaveLength(10);
    const payload = verifyCatalog(bootstrap, CURATED_APPS, {});
    expect(catalogEntries(CURATED_APPS, payload).every(entry => entry.status === 'pending' && !entry.release)).toBe(true);
  });
  it('accepts an independently signed catalog with complete evidence', () => {
    const { envelope, keys } = signedFixture();
    expect(verifyCatalog(envelope, CURATED_APPS, keys).releases).toHaveLength(1);
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
    release.evidence.qa.phases[phase].passed = false;
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
  it('blocks malware flags, unexpected publisher signatures, and self approval', () => {
    const release = releaseFixture();
    release.evidence.security.suspicious = 1;
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/malware/);
    release.evidence.security.suspicious = 0;
    release.evidence.signature.publisher = 'Impersonated publisher';
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/signer/);
    release.evidence.signature.publisher = CURATED_APPS[0].signaturePublishers[0];
    release.approvedBy = release.preparedBy.toUpperCase();
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/different reviewers/);
  });
  it('permits unsigned installers only with a reviewed app exception', () => {
    const app = CURATED_APPS.find(app => app.id === '7zip')!;
    expect(validateRelease(app, releaseFixture(app, '26.0'))).toBeTruthy();
    const release = releaseFixture();
    release.evidence.signature = { status: 'unsigned', publisher: null, exceptionReason: 'This is deliberately long but is not an approved exception.' };
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/unsigned/);
  });
  it('requires fresh evidence after discovery and a genuinely older upgrade source', () => {
    const release = releaseFixture();
    release.evidence.qa.testedAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/recent evidence/);
    release.evidence.qa.testedAt = release.evidence.verifiedAt;
    release.evidence.qa.upgradeFromVersion = release.candidate.version;
    expect(() => validateRelease(CURATED_APPS[0], release)).toThrow(/earlier version/);
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
      'http://downloads.videolan.org/pub/videolan/vlc/{version}/SHA256SUMS', 'https://downloads.videolan.org/pub/{version}/sums?file=x']) {
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
