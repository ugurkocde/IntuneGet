import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { archiveInstallerUrl, createCandidate, validateCandidate, validateDefinitions } from './core.mjs';
import { upgradeBaselineFromApproved } from './discovery.mjs';
import type { CuratedAppDefinition, CuratedRelease } from './types';

const now = new Date('2026-10-30T10:00:00Z');
const hash = '99ba538ca701c7c3b234d19b2236349c3aff3b55244ab9016072f74e6294e40a';
const calibre = () => CURATED_APPS.find(app => app.id === 'calibre')!;
const archiveTemplate = 'https://download.calibre-ebook.com/{version}/calibre-64bit-{version}.msi';
const configured = (): CuratedAppDefinition => ({ ...calibre(), archiveInstallerUrlTemplate: archiveTemplate });
const candidate = (version = '9.16.0', installerUrl = `https://github.com/kovidgoyal/calibre/releases/download/v${version}/calibre-64bit-${version}.msi`, vendorSha256: string | null = hash) =>
  createCandidate(calibre(), { version, installerUrl, vendorSha256 }, now);
const approved = (overrides: Partial<CuratedRelease> = {}): CuratedRelease => ({ candidate: candidate(), installerSha256: hash, ...overrides } as CuratedRelease);
const current = () => candidate('9.17.0', undefined, 'a91ea9b26af6cd057d8b193b86edb66d1535f7c5cb0a106965fa74f8168a6bd5');

afterEach(() => vi.unstubAllGlobals());

describe('approved upgrade baselines on publisher archives', () => {
  it('keeps the approved version and hash while rebinding its removed asset to the reviewed archive', () => {
    const fetcher = vi.fn(() => { throw new Error('Unexpected network request'); });
    vi.stubGlobal('fetch', fetcher);
    const previous = approved();
    const result = upgradeBaselineFromApproved(calibre(), previous, current(), now)!;
    expect(result.version).toBe('9.16.0');
    expect(result.appId).toBe('calibre');
    expect(result.installerUrl).toBe('https://download.calibre-ebook.com/9.16.0/calibre-64bit-9.16.0.msi');
    expect(result.vendorSha256).toBe(hash);
    expect(result.releaseNotesUrl).toBe(previous.candidate.releaseNotesUrl);
    expect(result.id).not.toBe(previous.candidate.id);
    expect(validateCandidate(calibre(), result, now)).toBe(result);
    expect(fetcher).not.toHaveBeenCalled();
    expect(previous.candidate.installerUrl).toContain('github.com/kovidgoyal');
  });

  it('leaves apps without an archive template and mutable current URLs unchanged', () => {
    const without = { ...configured() };
    delete without.archiveInstallerUrlTemplate;
    const previous = approved();
    expect(upgradeBaselineFromApproved(without, previous, current(), now)).toBe(previous.candidate);
    expect(upgradeBaselineFromApproved(configured(), null, current(), now)).toBeNull();
    expect(upgradeBaselineFromApproved(configured(), previous, previous.candidate, now)).toBeNull();
  });

  it('retains the identity of an already pinned archive candidate', () => {
    const previous = approved({ candidate: candidate('9.16.0', 'https://download.calibre-ebook.com/9.16.0/calibre-64bit-9.16.0.msi') });
    expect(upgradeBaselineFromApproved(configured(), previous, current(), now)).toBe(previous.candidate);
  });

  it('pins measured approved bytes even if the earlier candidate had no publisher hash', () => {
    const previous = approved({ candidate: candidate('9.16.0', undefined, null) });
    expect(upgradeBaselineFromApproved(configured(), previous, current(), now)?.vendorSha256).toBe(hash);
    const onArchive = approved({ candidate: candidate('9.16.0', 'https://download.calibre-ebook.com/9.16.0/calibre-64bit-9.16.0.msi', null) });
    expect(upgradeBaselineFromApproved(configured(), onArchive, current(), now)?.vendorSha256).toBe(hash);
  });

  it.each(['', 'invalid', 'a'.repeat(63), null])('rejects missing or malformed approved hashes: %s', installerSha256 => {
    expect(() => upgradeBaselineFromApproved(configured(), approved({ installerSha256: installerSha256 as string }), current(), now)).toThrow();
  });

  it('rejects contradictory publisher and approved hashes without discarding the previous installer', () => {
    expect(() => upgradeBaselineFromApproved(configured(), approved({ installerSha256: 'b'.repeat(64) }), current(), now)).toThrow();
  });

  it.each(['9.17.0', '9.18.0'])('rejects an approved version that is not older: %s', version => {
    expect(() => upgradeBaselineFromApproved(configured(), approved({ candidate: candidate(version, `https://download.calibre-ebook.com/${version}/calibre-64bit-${version}.msi`) }), current(), now)).toThrow();
  });

  it.each([
    'https://download.calibre-ebook.com/9.16.0/calibre.msi',
    'https://download.calibre-ebook.com/{other}/calibre-{version}.msi',
    'http://download.calibre-ebook.com/{version}/calibre.msi',
    'https://download.calibre-ebook.com/{version}/calibre.msi?download=1',
    'https://download.calibre-ebook.com/{version}/calibre.msi#',
    'https://user@download.calibre-ebook.com/{version}/calibre.msi',
    'https://download.calibre-ebook.com/{version}/%2fcalibre.msi',
    'https://example.invalid/{version}/calibre.msi',
    'https://download.calibre-ebook.com/{version}/calibre.zip',
    'https://download.calibre-ebook.com/{version}/../calibre.msi',
    `https://download.calibre-ebook.com/{version}/${'x'.repeat(300)}.msi`,
  ])('rejects unsafe archive templates: %s', archiveInstallerUrlTemplate => {
    expect(() => validateDefinitions([{ ...calibre(), archiveInstallerUrlTemplate }])).toThrow();
  });

  it.each(['9.16.0/..', '9.16.0-rc1', '', '1.2.3.4.5'])('rejects unsafe versions: %s', version => {
    expect(() => archiveInstallerUrl(configured(), version)).toThrow();
  });

  it('keeps all fifty definitions valid and their initial upgrade baseline separate', () => {
    expect(validateDefinitions(CURATED_APPS)).toHaveLength(50);
    expect(calibre().initialUpgradeBaseline?.version).toBe('9.14.0');
    expect(calibre().archiveInstallerUrlTemplate).toBe(archiveTemplate);
  });
});
