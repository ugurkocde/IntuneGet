import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { findDuplicateIntuneApp } from '../src/duplicate-app';

function graphMock(...responses: unknown[]) {
  const get = vi.fn<(path: string) => Promise<unknown>>();
  for (const response of responses) {
    get.mockResolvedValueOnce(response);
  }

  return {
    get,
    client: {
      get: <T>(path: string) => get(path) as Promise<T>,
    },
  };
}

const job = {
  display_name: 'draw.io',
  winget_id: 'JGraph.Draw',
};

describe('findDuplicateIntuneApp', () => {
  it('uses only base mobileApp fields in the collection query, then reads Win32 details', async () => {
    const graph = graphMock(
      {
        value: [
          {
            id: 'existing-app',
            displayName: 'DRAW.IO',
            description: 'Deployed via IntuneGet from Winget: jgraph.draw',
          },
        ],
      },
      {
        id: 'existing-app',
        displayVersion: '30.2.6',
        createdDateTime: '2026-07-09T18:00:00Z',
        publishingState: 'published',
        committedContentVersion: '1',
      },
    );

    await expect(findDuplicateIntuneApp(graph.client, job)).resolves.toEqual({
      matchType: 'exact',
      existingAppId: 'existing-app',
      existingAppUrl:
        'https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/existing-app',
      existingVersion: '30.2.6',
      createdAt: '2026-07-09T18:00:00Z',
    });

    const collectionPath = graph.get.mock.calls[0][0];
    expect(collectionPath).toContain('$select=id,displayName,description');
    expect(collectionPath).not.toMatch(
      /displayVersion|publishingState|committedContentVersion|createdDateTime/,
    );
    expect(graph.get.mock.calls[1][0]).toBe(
      '/deviceAppManagement/mobileApps/existing-app',
    );
  });

  it('ignores incomplete matches and follows either v1.0 or beta next links', async () => {
    const graph = graphMock(
      {
        value: [
          {
            id: 'incomplete-app',
            displayName: 'draw.io',
            description: 'Source: IntuneGet.com',
          },
        ],
        '@odata.nextLink':
          'https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps?$skiptoken=next',
      },
      {
        id: 'incomplete-app',
        publishingState: 'processing',
        committedContentVersion: '   ',
      },
      {
        value: [
          {
            id: 'committed-app',
            displayName: 'draw.io',
            description: 'Source: IntuneGet.com',
          },
        ],
      },
      {
        id: 'committed-app',
        publishingState: 'published',
        committedContentVersion: '2',
      },
    );

    const result = await findDuplicateIntuneApp(graph.client, job);

    expect(result?.existingAppId).toBe('committed-app');
    expect(graph.get.mock.calls[2][0]).toBe(
      '/deviceAppManagement/mobileApps?$skiptoken=next',
    );
  });

  it('does not treat a different Winget fingerprint as a duplicate', async () => {
    const graph = graphMock({
      value: [
        {
          id: 'other-app',
          displayName: 'draw.io',
          description: 'Source: IntuneGet.com - Winget: Different.Package',
        },
      ],
    });

    await expect(findDuplicateIntuneApp(graph.client, job)).resolves.toBeNull();
    expect(graph.get).toHaveBeenCalledTimes(1);
  });

  it('propagates Graph errors so duplicate protection fails closed', async () => {
    const get = vi.fn().mockRejectedValue(new Error('Graph unavailable'));

    await expect(
      findDuplicateIntuneApp({ get }, job),
    ).rejects.toThrow('Graph unavailable');
  });
});

describe('hosted duplicate-check script', () => {
  it('keeps derived Win32 properties out of the base collection projection', () => {
    const scriptPath = fileURLToPath(
      new URL('../../.github/scripts/Check-DuplicateApp.ps1', import.meta.url),
    );
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('$select = "id,displayName,description"');
    expect(script).toContain('$detailUrl = "$baseUrl/$($app.id)"');
    expect(script).not.toMatch(
      /\$select\s*=\s*"[^"]*(?:displayVersion|publishingState|committedContentVersion)/,
    );
  });
});
