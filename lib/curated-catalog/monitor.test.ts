import { describe, expect, it } from 'vitest';
import { CURATED_APPS } from './definitions';
import { canonicalJson, createCandidate, sha256 } from './core.mjs';
import { curatedMonitor } from './monitor.mjs';
import { releaseFixture, signedFixture } from './test-fixtures';

describe('curated monitoring', () => {
  it('reports independent source failures, new approvals and near expiry', () => {
    const release = releaseFixture();
    const payload = signedFixture([release]).envelope.payload;
    const discovery = { generatedAt: new Date().toISOString(), definitionsSha256: sha256(canonicalJson(CURATED_APPS)),
      results: CURATED_APPS.map(app => app.id === release.candidate.appId ? { appId: app.id, state: 'candidate', candidate: releaseFixture(app, '121.0').candidate } : { appId: app.id, state: 'error' }) };
    const result = curatedMonitor(CURATED_APPS, payload, discovery);
    expect(result.approved).toBe(1); expect(result.pending[0]).toContain('121.0');
    expect(result.alerts).toHaveLength(10); expect(result.alerts.at(-1)).toContain('expires');
    expect(() => curatedMonitor(CURATED_APPS, payload, { ...discovery, definitionsSha256: 'bad' })).toThrow();
  });
  it('alerts on replaced checksums without approving the replacement', () => {
    const app = CURATED_APPS[0]; const release = releaseFixture();
    const payload = signedFixture([release]).envelope.payload;
    const replacement = createCandidate(app, { ...release.candidate, vendorSha256: 'b'.repeat(64) });
    const result = curatedMonitor(CURATED_APPS, payload, { generatedAt: new Date().toISOString(), definitionsSha256: sha256(canonicalJson(CURATED_APPS)),
      results: CURATED_APPS.map(item => item.id === app.id ? { appId: app.id, state: 'candidate', candidate: replacement } : { appId: item.id, state: 'manual' }) });
    expect(result.pending.some(item => item.startsWith('Google Chrome'))).toBe(false);
    expect(result.alerts.some(item => item.includes('changed an already approved'))).toBe(true);
    expect(payload.releases).toHaveLength(1);
  });
});
