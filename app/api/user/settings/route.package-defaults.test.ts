import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state: { stored: unknown; configured: boolean; lastUpsert: unknown } = {
    stored: null,
    configured: true,
    lastUpsert: null,
  };
  const client = {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: state.stored === null ? null : { settings: state.stored }, error: null }),
        upsert: (row: { settings: unknown }) => {
          state.lastUpsert = row.settings;
          state.stored = row.settings;
          return builder;
        },
        single: () => Promise.resolve({ data: { settings: state.stored }, error: null }),
      };
      return builder;
    },
  };
  return { state, client };
});

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => h.client,
  isSupabaseServerConfigured: () => h.state.configured,
}));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async (header: string | null) => (header ? { userId: 'user-a' } : null),
}));

import { GET, PATCH } from './route';

function patch(body: unknown) {
  return PATCH(new NextRequest('http://localhost/api/user/settings', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}
function get() {
  return GET(new NextRequest('http://localhost/api/user/settings', { headers: { Authorization: 'Bearer t' } }));
}

const forbidden = {
  installCommand: 'evil.exe', uninstallCommand: 'x', detectionRules: [{ type: 'file' }],
  processesToClose: [{ name: 'x' }], registryMarkerPath: 'HKLM\\x', reviewedExactUninstall: true,
  brandingLogoPath: 'C:\\x.png', postInstallCommands: ['x'], verifyInstall: false,
  customPrompts: [], deferDeadline: '2026-01-01', requiredDiskSpace: 5,
  forceCloseProcessesCountdown: 30,
};

beforeEach(() => {
  h.state.stored = null;
  h.state.configured = true;
  h.state.lastUpsert = null;
});

describe('package defaults in user settings', () => {
  it.each(['x', 1, true])('rejects scalar defaults %s even alongside a valid setting', async (value) => {
    for (const body of [{ packageDefaults: value }, { theme: 'dark', packageDefaults: value }]) {
      expect((await patch(body)).status).toBe(400);
      expect(h.state.lastUpsert).toBeNull();
    }
  });

  it('allows other settings when defaults are omitted', async () => {
    expect((await patch({ theme: 'dark' })).status).toBe(200);
    expect(h.state.lastUpsert).toMatchObject({ theme: 'dark' });
  });

  it('replaces defaults so an omitted optional deferral limit is removed', async () => {
    h.state.stored = { packageDefaults: { allowDefer: true, deferDays: 7 }, theme: 'dark' };
    expect((await patch({ packageDefaults: { allowDefer: true } })).status).toBe(200);
    expect(h.state.lastUpsert).toEqual({ packageDefaults: { allowDefer: true }, theme: 'dark' });
  });
  it('returns null defaults when nothing is stored', async () => {
    const body = await (await get()).json();
    expect(body.settings.packageDefaults).toBeNull();
  });

  it('keeps only allowlisted values and drops commands, detection, paths and verifyInstall', async () => {
    const response = await patch({
      packageDefaults: {
        ...forbidden,
        deployMode: 'NonInteractive', allowDefer: true, deferTimes: 5, closeCountdown: 120,
        restartPrompt: { enabled: true, countdownSeconds: 600, countdownNoHideSeconds: 60 },
      },
    });
    expect(response.status).toBe(200);
    const stored = (h.state.lastUpsert as { packageDefaults: unknown }).packageDefaults;
    expect(stored).toEqual({
      deployMode: 'NonInteractive', allowDefer: true, deferTimes: 5, closeCountdown: 120,
      restartPrompt: { enabled: true, countdownSeconds: 600, countdownNoHideSeconds: 60 },
    });
    expect((await response.json()).settings.packageDefaults).toEqual(stored);
  });

  it('drops out of range, fractional and unknown enum values', async () => {
    await patch({ packageDefaults: { deployMode: 'Loud', deferTimes: 0, deferDays: 1.5, closeCountdown: 9999, allowDefer: 'yes', restartPrompt: { enabled: true, countdownSeconds: 5, countdownNoHideSeconds: 60 }, checkDiskSpace: true } });
    expect((h.state.lastUpsert as { packageDefaults: unknown }).packageDefaults).toEqual({ checkDiskSpace: true });
  });

  it('rejects array payloads and array defaults', async () => {
    expect((await patch([{ packageDefaults: { allowDefer: true } }])).status).toBe(400);
    expect((await patch({ packageDefaults: [{ allowDefer: true }] })).status).toBe(400);
    expect(h.state.lastUpsert).toBeNull();
  });

  it('clears stored defaults with an explicit null', async () => {
    h.state.stored = { packageDefaults: { allowDefer: true }, theme: 'dark' };
    const response = await patch({ packageDefaults: null });
    expect(response.status).toBe(200);
    expect(h.state.lastUpsert).toEqual({ packageDefaults: null, theme: 'dark' });
  });

  it('preserves saved defaults when an object contains no valid values', async () => {
    h.state.stored = { packageDefaults: { deployMode: 'Auto' }, theme: 'dark' };
    const before = structuredClone(h.state.stored);
    expect((await patch({ packageDefaults: { deferTimes: 0, installCommand: 'bad' } })).status).toBe(400);
    expect((await patch({ packageDefaults: {} })).status).toBe(400);
    expect(h.state.lastUpsert).toBeNull();
    expect(h.state.stored).toEqual(before);
  });

  it('cleans garbage stored defaults on read', async () => {
    h.state.stored = { packageDefaults: { installCommand: 'evil.exe', verifyInstall: false, deployMode: 'Auto' } };
    const body = await (await get()).json();
    expect(body.settings.packageDefaults).toEqual({ deployMode: 'Auto' });
  });

  it('fails truthfully when hosted persistence is unavailable', async () => {
    h.state.configured = false;
    expect((await patch({ packageDefaults: { allowDefer: true } })).status).toBe(503);
    const body = await (await get()).json();
    expect(body.settings.packageDefaults).toBeNull();
  });
});


it('round trips and clears company defaults while preserving other preferences', async () => {
  expect((await patch({ packageDefaults: { brandingCompanyName: 'Personal company', allowDefer: false } })).status).toBe(200);
  expect((await (await get()).json()).settings.packageDefaults).toEqual({ brandingCompanyName: 'Personal company', allowDefer: false });
  expect((await patch({ packageDefaults: { brandingCompanyName: '', allowDefer: false } })).status).toBe(200);
  expect((await (await get()).json()).settings.packageDefaults).toEqual({ brandingCompanyName: '', allowDefer: false });
  expect((await patch({ packageDefaults: null })).status).toBe(200);
  expect((await (await get()).json()).settings.packageDefaults).toBeNull();
});

it.each(['x'.repeat(129), '\u202Eprivate', '\u061Cprivate', 42, null])('rejects invalid company text alongside valid preferences', async (brandingCompanyName) => {
  expect((await patch({ packageDefaults: { brandingCompanyName, allowDefer: true } })).status).toBe(400);
  expect(h.state.lastUpsert).toBeNull();
});

it('requires authentication for company defaults reads and writes', async () => {
  expect((await GET(new NextRequest('http://localhost/api/user/settings'))).status).toBe(401);
  expect((await PATCH(new NextRequest('http://localhost/api/user/settings', { method: 'PATCH', body: JSON.stringify({ packageDefaults: { brandingCompanyName: 'Personal company' } }) }))).status).toBe(401);
  expect(h.state.lastUpsert).toBeNull();
});
