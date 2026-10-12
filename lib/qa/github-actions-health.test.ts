import { describe, expect, it, vi } from 'vitest';
import { getGitHubActionsHealth } from './github-actions-health';

describe('getGitHubActionsHealth', () => {
  it('allows dispatch only when the Actions component is operational', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      components: [
        { name: 'Git Operations', status: 'operational' },
        { name: 'Actions', status: 'operational' },
      ],
    }), { status: 200 }));

    await expect(getGitHubActionsHealth(fetchMock)).resolves.toEqual({
      operational: true,
      status: 'operational',
    });
  });

  it('blocks dispatch during a reported Actions outage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      components: [{ name: 'Actions', status: 'major_outage' }],
    }), { status: 200 }));

    await expect(getGitHubActionsHealth(fetchMock)).resolves.toEqual({
      operational: false,
      status: 'major_outage',
    });
  });

  it('fails closed when the status response cannot be trusted', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));

    await expect(getGitHubActionsHealth(fetchMock)).resolves.toEqual({
      operational: false,
      status: 'unknown',
    });
  });
});
