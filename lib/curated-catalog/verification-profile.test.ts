import { describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { releaseFixture } from './test-fixtures';
import { buildCuratedCartItem, curatedWorkflowInput } from './package';
import { createCuratedVerificationProfile, rebuildCuratedExecutionConfig } from './verification-profile';

vi.mock('@/lib/supabase', () => ({ getServerClientOrNull: () => null }));
import { compareCuratedExecution } from './custom-config';

describe('curated configuration carry-forward normalization', () => {
  const app = CURATED_APPS.find(item => item.id === '7zip')!;
  const previous = releaseFixture(app, '26.03');
  const next = releaseFixture(app, '26.04');

  it('replaces stale detection with signed rules while preserving execution settings and stripping presentation', () => {
    const oldProfile = createCuratedVerificationProfile(previous.candidate, previous.installerSha256, {
      deployMode: 'Silent', processesToClose: [{ name: '7zFM', description: '7-Zip' }], brandingCompanyName: 'Contoso',
    });
    const oldConfig = JSON.parse(oldProfile.workflowInput.psadtConfig);
    const rebuilt = rebuildCuratedExecutionConfig(next, oldConfig);
    const item = buildCuratedCartItem(app, next);
    const comparison = compareCuratedExecution(app, next,
      curatedWorkflowInput({ ...item, psadtConfig: rebuilt.executionConfig as unknown as typeof item.psadtConfig }));
    expect(rebuilt.psadtConfigSha256).toBe(comparison.psadtConfigSha256);
    expect(rebuilt.psadtConfigSha256).not.toBe(oldProfile.psadtConfigSha256);
    // Process descriptions are presentation; only process names affect execution.
    expect(rebuilt.executionConfig).toMatchObject({ deployMode: 'Silent', processesToClose: [{ name: '7zFM', description: '7zFM' }] });
    expect(rebuilt.executionConfig.brandingCompanyName).toBeUndefined();
    expect(JSON.stringify(rebuilt.executionConfig.detectionRules)).toContain('26.04');
    expect(JSON.stringify(rebuilt.executionConfig.detectionRules)).not.toContain('26.03');
    expect(oldConfig).toEqual(JSON.parse(oldProfile.workflowInput.psadtConfig));
    expect(rebuildCuratedExecutionConfig(next, rebuilt.executionConfig)).toEqual(rebuilt);
  });

  it('rejects a signed installer hash mismatch instead of carrying settings', () => {
    const candidate = { ...next.candidate, vendorSha256: 'a'.repeat(64) };
    expect(() => rebuildCuratedExecutionConfig({ ...next, candidate, installerSha256: 'b'.repeat(64) }, {})).toThrow(/matching verified installer/);
  });

  it('rejects an unknown curated candidate', () => {
    expect(() => rebuildCuratedExecutionConfig({ ...next, candidate: { ...next.candidate, appId: 'unknown' } }, {})).toThrow(/Unknown curated app/);
  });
});
