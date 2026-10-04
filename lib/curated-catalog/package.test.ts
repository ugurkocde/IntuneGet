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
