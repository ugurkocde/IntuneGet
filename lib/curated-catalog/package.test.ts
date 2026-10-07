import { describe, expect, it } from 'vitest';
import { CURATED_APPS } from './definitions';
import { assertCuratedPackageProfile, buildCuratedCartItem, curatedWorkflowInput } from './package';
import { releaseFixture } from './test-fixtures';
import { canonicalQaJson, normalizeQaWorkflowPackageInput, QA_PACKAGER_RELEASE_HISTORY, QA_PSADT_TOOLCHAIN, qaSha256 } from '@/lib/qa/package-profile';

// A release as if it had been tested on an earlier shared packager release.
function testedOn(packagerCommit: string) {
  const app = CURATED_APPS[0];
  const release = releaseFixture(app);
  const current = JSON.parse(normalizeQaWorkflowPackageInput(curatedWorkflowInput(buildCuratedCartItem(app, release))).identity.canonicalJson);
  const prior = qaSha256(canonicalQaJson({ ...current, toolchain: { ...current.toolchain, packagerCommit } }));
  release.executionProfileSha256 = prior;
  release.evidence.qa.executionProfileSha256 = prior;
  release.evidence.qa.packagerCommit = packagerCommit;
  return { app, release };
}

describe('curated packager compatibility', () => {
  it('keeps a release deployable across later unrelated packager releases', () => {
    const { app, release } = testedOn(QA_PACKAGER_RELEASE_HISTORY.at(-2)!);
    expect(release.evidence.qa.packagerCommit).not.toBe(QA_PSADT_TOOLCHAIN.packagerCommit);
    expect(() => assertCuratedPackageProfile(app, release)).not.toThrow();
  });
  it('withholds a release from an unknown packager or with a changed profile', () => {
    const unknown = testedOn('f'.repeat(40));
    expect(() => assertCuratedPackageProfile(unknown.app, unknown.release)).toThrow(/current packaging configuration/);
    const changed = testedOn(QA_PACKAGER_RELEASE_HISTORY.at(-2)!);
    changed.release.executionProfileSha256 = 'c'.repeat(64);
    expect(() => assertCuratedPackageProfile(changed.app, changed.release)).toThrow(/current packaging configuration/);
  });
});

describe('curated registered uninstall identity', () => {
  const app = (id: string) => CURATED_APPS.find(app => app.id === id)!;
  it('uses the exact Apps and Features key or MSI product code instead of the catalog title', () => {
    expect(buildCuratedCartItem(app('vscode'), releaseFixture(app('vscode'), '1.140.0')).uninstallCommand)
      .toBe('REGISTRY_UNINSTALL_KEY:{EA457B21-F73E-494C-ACAB-524FDE069978}_is1:Microsoft Visual Studio Code');
    expect(buildCuratedCartItem(app('acrobat-reader'), releaseFixture(app('acrobat-reader'), '26.002.21931')).uninstallCommand)
      .toBe('REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Adobe Acrobat (64-bit)');
    expect(buildCuratedCartItem(app('git'), releaseFixture(app('git'), '2.56.0')).uninstallCommand).toBe('REGISTRY_UNINSTALL_KEY:Git_is1:Git');
  });
  it('leaves apps without a registered identity unchanged', () => {
    expect(buildCuratedCartItem(app('vlc'), releaseFixture(app('vlc'), '3.0.24')).uninstallCommand).toBe('REGISTRY_UNINSTALL:VLC media player');
  });
});

describe('curated reviewed removal arguments', () => {
  it('uses the same hash-bound WinRAR removal contract for customer and QA packages', () => {
    const app = CURATED_APPS.find(app => app.id === 'winrar')!;
    const release = releaseFixture(app, '7.23');
    const item = buildCuratedCartItem(app, release);
    expect(item.uninstallCommand).toBe('REGISTRY_UNINSTALL_KEY:WinRAR archiver:WinRAR (64-bit)');
    expect(item.psadtConfig.reviewedUninstallArguments).toEqual(['/s']);
    const input = curatedWorkflowInput(item);
    expect(JSON.parse(input.psadtConfig).reviewedUninstallArguments).toEqual(['/s']);
    const current = normalizeQaWorkflowPackageInput(input).identity.executionProfileSha256;
    const missing = normalizeQaWorkflowPackageInput({ ...input, psadtConfig: JSON.stringify({ ...item.psadtConfig, reviewedUninstallArguments: [] }) }).identity.executionProfileSha256;
    expect(current).not.toBe(missing);
    release.executionProfileSha256 = current;
    release.evidence.qa.executionProfileSha256 = current;
    expect(() => assertCuratedPackageProfile(app, release)).not.toThrow();
    expect(() => assertCuratedPackageProfile(app, release, { ...input, psadtConfig: JSON.stringify({ ...item.psadtConfig, reviewedUninstallArguments: [] }) })).toThrow(/differs/);
    item.psadtConfig.reviewedUninstallArguments!.push('/changed');
    expect(app.reviewedUninstallArguments).toEqual(['/s']);
  });
});
