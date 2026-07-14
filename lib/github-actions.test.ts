import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  triggerPackagingWorkflow,
  type GitHubActionsConfig,
  type WorkflowInputs,
} from './github-actions';

const config: GitHubActionsConfig = {
  token: 'test-token',
  owner: 'example',
  repo: 'public-repo',
  workflowsRepo: 'workflow-repo',
  workflowFile: 'package-intunewin.yml',
  ref: 'main',
};

function workflowInputs(overrides: Partial<WorkflowInputs> = {}): WorkflowInputs {
  return {
    jobId: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7',
    tenantId: '11111111-1111-1111-1111-111111111111',
    wingetId: 'Custom.Example.App',
    displayName: 'Example App',
    publisher: 'Example',
    version: '1.0.0',
    architecture: 'x64',
    installerUrl: 'https://example.com/setup.exe',
    installerSha256: '',
    installerType: 'exe',
    silentSwitches: '/S',
    uninstallCommand: 'uninstall.exe /S',
    callbackUrl: 'https://example.test/api/package/callback',
    hashValidationMode: 'calculate',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('triggerPackagingWorkflow hash validation payload', () => {
  it('dispatches calculate mode for a custom installer without a trusted hash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(workflowInputs(), config, { skipRunCapture: true });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer).toEqual(
      expect.objectContaining({
        sha256: '',
        hashValidationMode: 'calculate',
      })
    );
  });

  it('defaults to strict mode when no mode override is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await triggerPackagingWorkflow(
      workflowInputs({
        installerSha256: 'a'.repeat(64),
        hashValidationMode: undefined,
      }),
      config,
      { skipRunCapture: true }
    );

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.client_payload.installer.hashValidationMode).toBe('strict');
  });
});
