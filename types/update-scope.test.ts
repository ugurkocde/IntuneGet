import { describe, expect, it } from 'vitest';
import { autoUpdateScopeReason, classifyUpdateType } from './update-policies';

describe('automatic update scopes', () => {
  it.each([
    ['v1.2.3', 'v2.0.0', 'major'],
    ['1.2.3.4', '1.3.0.0', 'minor'],
    ['2025.10.1', '2026.1.1', 'major'],
    ['9', '10', 'major'],
  ])('classifies %s to %s', (from, to, kind) => {
    expect(classifyUpdateType(from, to)).toBe(kind);
  });
  it.each(['major', 'minor'])('fails closed for unknown versions under %s', scope => {
    expect(autoUpdateScopeReason(scope, 'unknown', '2.0')).toContain('cannot be compared');
    expect(autoUpdateScopeReason(scope, '1.0', '2.0-beta')).toContain('cannot be compared');
  });
  it('keeps all updates compatible and rejects an invalid stored scope', () => {
    expect(autoUpdateScopeReason(undefined, 'unknown', 'latest')).toBeNull();
    expect(autoUpdateScopeReason('all', 'unknown', 'latest')).toBeNull();
    expect(autoUpdateScopeReason('unexpected', '1.0', '2.0')).toContain('Invalid');
  });
  it('only permits selected forward version changes', () => {
    expect(autoUpdateScopeReason('major', '1.0', '1.1')).toContain('Major only');
    expect(autoUpdateScopeReason('minor', '1.0.0', '1.0.1')).toContain('Minor and major');
    expect(autoUpdateScopeReason('minor', '1.0', '1.1')).toBeNull();
    expect(autoUpdateScopeReason('major', 'v1.0', 'v2.0')).toBeNull();
    expect(autoUpdateScopeReason('minor', '2.9', '1.10')).not.toBeNull();
    expect(autoUpdateScopeReason('major', '2.0', '2.0')).not.toBeNull();
  });
});
