import { describe, expect, it } from 'vitest';
import { describeDeploymentFailure } from '../deployment-failure-message';

const apps = [{ wingetId: 'Example.One', displayName: 'Example One' }, { wingetId: 'Example.Two', displayName: 'Example Two' }];
describe('safe deployment failure messages', () => {
  it('names each requested app and its fixed application reason in response order', () => {
    expect(describeDeploymentFailure({ errors: [
      { wingetId: 'Example.Two', error: 'Failed to create job record' },
      { wingetId: 'Example.One', error: 'GitHub Actions packaging service not configured' },
    ] }, apps)).toBe('Example Two: Failed to create job record\nExample One: GitHub Actions packaging service not configured');
  });

  it.each([
    'Token acquisition failed: AADSTS private-tenant trace private-trace',
    '{"errorBody":{"message":"Graph private-tenant","request-id":"private-request"}}',
    'GITHUB_PAT Bearer private-token https://example.test/file?sig=private-signature',
    'Packaging pipeline not configured private-secret',
    'toString',
  ])('does not display raw diagnostics or match reason prefixes: %s', error => {
    expect(describeDeploymentFailure({ errors: [{ wingetId: 'Example.One', error }] }, apps)).toBe('Example One: Could not be started');
  });

  it.each([null, 'bad', {}, { wingetId: '', error: '' }, { wingetId: 123, error: 456 }, { wingetId: 'unknown', error: 'Failed to create job record' }])('handles malformed or unrecognized entries: %j', entry => {
    expect(describeDeploymentFailure({ errors: [entry] }, apps)).toBe('Selected app: Could not be started');
  });

  it.each([undefined, null, {}, { errors: [] }, { errors: 'bad' }, { errors: [], message: 'Bearer private-token' }])('uses a safe fallback when no usable error array exists: %j', data => {
    expect(describeDeploymentFailure(data, apps)).toBe('No jobs were created');
  });

  it('preserves the fixed count summary when no per-app reasons exist', () => {
    expect(describeDeploymentFailure({ message: '0 job(s) processed, 2 failed' }, apps)).toBe('0 job(s) processed, 2 failed');
  });

  it('bounds error lines and never copies an unknown response app identifier', () => {
    const errors = Array.from({ length: 9 }, () => ({ wingetId: 'private-unrequested-id', error: 'Failed to create job record' }));
    expect(describeDeploymentFailure({ errors }, apps).split('\n')).toEqual([
      ...Array(5).fill('Selected app: Could not be started'), 'And 4 more',
    ]);
  });

  it('uses the requested package ID when its display name is empty and flattens label newlines', () => {
    const errors = [{ wingetId: 'Example.One', error: 'Failed to create job record' }];
    expect(describeDeploymentFailure({ errors }, [{ wingetId: 'Example.One', displayName: '' }])).toBe('Example.One: Failed to create job record');
    expect(describeDeploymentFailure({ errors }, [{ wingetId: 'Example.One', displayName: 'Example\nOne' }])).toBe('Example One: Failed to create job record');
  });
});
