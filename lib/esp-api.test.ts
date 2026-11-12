import { afterEach, describe, expect, it, vi } from 'vitest';
import { listEspProfiles } from './esp-api';

afterEach(() => vi.unstubAllGlobals());

describe('listEspProfiles', () => {
  it('handles a forbidden response without consuming private Graph details', async () => {
    const json = vi.fn().mockResolvedValue({ error: { message: 'private-tenant fixture@example.invalid' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', json }));
    await expect(listEspProfiles('fixture-token')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('existing DeviceManagementServiceConfig.ReadWrite.All admin consent'),
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('does not consume upstream details for other failures', async () => {
    const json = vi.fn().mockResolvedValue({ error: { message: 'private-tenant fixture@example.invalid' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Private upstream detail', json }));
    await expect(listEspProfiles('fixture-token')).rejects.toMatchObject({
      status: 500, message: 'Failed to list device enrollment configurations (500)',
    });
    expect(json).not.toHaveBeenCalled();
  });

  it('keeps successful profile filtering and sorting', async () => {
    const profile = (id: string, displayName: string) => ({ id, displayName, '@odata.type': '#microsoft.graph.windows10EnrollmentCompletionPageConfiguration' });
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: [profile('b', 'Beta'), { id: 'other', displayName: 'Other', '@odata.type': '#microsoft.graph.other' }, profile('a', 'Alpha')] }) });
    vi.stubGlobal('fetch', fetch);
    expect((await listEspProfiles('fixture-token')).map(p => p.id)).toEqual(['a', 'b']);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/beta/deviceManagement/deviceEnrollmentConfigurations');
    expect(url.searchParams.get('$select')).toBe('id,displayName,description');
  });
});
