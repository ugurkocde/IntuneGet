import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchQaCandidate } from './dispatch';

vi.mock('@/lib/github-actions', () => ({
  getGitHubActionsConfig: () => ({
    token: 'secret-token',
    owner: 'example',
    workflowsRepo: 'workflows',
    ref: 'main',
  }),
}));

afterEach(() => vi.unstubAllGlobals());

describe('dispatchQaCandidate', () => {
  it('dispatches only exact public candidate metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await dispatchQaCandidate({
      id: '11111111-1111-4111-8111-111111111111',
      definition_path: 'qa/apps/example.app.json',
      version: '2.0.0',
      installer_url: 'https://example.test/setup.exe',
      installer_sha256: 'A'.repeat(64),
      installer_file_name: 'setup.exe',
      installer_type: 'exe',
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('/actions/workflows/intune-qa.yml/dispatches');
    const body = JSON.parse(String((request as RequestInit).body));
    expect(body.inputs).toMatchObject({
      app_definition: 'qa/apps/example.app.json',
    });
    expect(JSON.parse(body.inputs.candidate_payload)).toMatchObject({
      version: '2.0.0',
      installerSha256: 'A'.repeat(64),
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });

  it('surfaces a rejected GitHub dispatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403 })));
    await expect(
      dispatchQaCandidate({
        id: '11111111-1111-4111-8111-111111111111',
        definition_path: 'qa/apps/example.app.json',
        version: '2.0.0',
        installer_url: 'https://example.test/setup.exe',
        installer_sha256: 'A'.repeat(64),
        installer_file_name: 'setup.exe',
        installer_type: 'exe',
      })
    ).rejects.toThrow('403');
  });
});
