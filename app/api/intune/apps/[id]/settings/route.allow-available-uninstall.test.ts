import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  appType: '#microsoft.graph.win32LobApp',
  row: {
    id: 'job-1',
    updated_at: '2026-11-27T00:00:00.000Z',
    package_config: { description: 'Contoso', assignments: [] as unknown[] } as Record<string, unknown>,
  },
  policyRow: {
    id: 'policy-1',
    updated_at: '2026-11-27T00:00:00.000Z',
    deployment_config: { displayName: 'Contoso', publisher: 'Contoso', architecture: 'x64', installerType: 'exe', installCommand: '/S', uninstallCommand: '/U', installScope: 'machine', detectionRules: [] } as Record<string, unknown>,
  },
  policyUpdateConflict: false,
  policyReadError: false,
  policyReadOrder: [] as string[],
  policyUpdateEqFilters: [] as Array<[string, unknown]>,
  jobUpdates: [] as Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  savedJobConfig: null as Record<string, unknown> | null,
  savedPolicyConfig: null as Record<string, unknown> | null,
  updateAllowAvailableUninstall: vi.fn(async () => undefined),
}));

vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => ({ userId: 'owner', tenantId: 'tenant-1' }) }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: async () => ({ tenantId: 'tenant-1', errorResponse: null }) }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: async () => 'fixture-token' }));
vi.mock('@/lib/intune-api', () => ({
  getApp: async () => ({ id: '11111111-1111-4111-8111-111111111111', '@odata.type': state.appType, displayName: 'Contoso' }),
  syncAppCategories: async () => undefined,
  assignToGroups: async () => undefined,
  convertToGraphAssignments: () => [],
  setAppRules: async () => undefined,
  updateWin32AllowAvailableUninstall: state.updateAllowAvailableUninstall,
}));
vi.mock('@/lib/intune-relationships', () => ({
  syncAppRelationships: async () => [],
  RelationshipUpdateError: class extends Error {},
}));
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({ jobs: { getLatestDeployed: async () => state.row } }),
}));
vi.mock('@/lib/supabase', () => ({
  getServerClientOrNull: () => ({
    from: (table: string) => {
      let updatePayload: Record<string, unknown> | null = null;
      const eqFilters: Array<[string, unknown]> = [];
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (col: string, val: unknown) => {
          eqFilters.push([col, val]);
          return chain;
        },
        is: () => chain,
        single: async () => ({ data: table === 'tenant_consent', error: null }),
        update: (value: Record<string, unknown>) => {
          updatePayload = value;
          return chain;
        },
        maybeSingle: async () => {
          if (table === 'packaging_jobs') {
            if (updatePayload) {
              state.policyReadOrder.push('job-update');
              state.jobUpdates.push({ payload: updatePayload, filters: [...eqFilters] });
              state.savedJobConfig = updatePayload.package_config as Record<string, unknown>;
              return { data: { id: state.row.id, updated_at: '2026-11-27T00:01:00.000Z' }, error: null };
            }
            state.policyReadOrder.push('job-read');
            return { data: state.row, error: null };
          }
          if (table === 'app_update_policies') {
            if (updatePayload) {
              state.policyReadOrder.push('policy-update');
              state.policyUpdateEqFilters = [...eqFilters];
              if (state.policyUpdateConflict) {
                return { data: null, error: null };
              }
              state.savedPolicyConfig = updatePayload.deployment_config as Record<string, unknown>;
              return { data: { id: state.policyRow.id }, error: null };
            }
            state.policyReadOrder.push('policy-read');
            if (state.policyReadError) {
              return { data: null, error: { message: 'policy read failed' } };
            }
            return { data: state.policyRow, error: null };
          }
          return { data: null, error: null };
        },
      };
      return chain;
    },
  }),
}));

import { PATCH } from './route';

function call(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('https://fixture.invalid/api/intune/apps/11111111-1111-4111-8111-111111111111/settings', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer fixture' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }) }
  );
}

describe('PATCH /api/intune/apps/[id]/settings allowAvailableUninstall', () => {
  beforeEach(() => {
    state.appType = '#microsoft.graph.win32LobApp';
    state.policyUpdateConflict = false;
    state.policyReadError = false;
    state.policyReadOrder = [];
    state.policyUpdateEqFilters = [];
    state.jobUpdates = [];
    state.savedJobConfig = null;
    state.savedPolicyConfig = null;
    state.updateAllowAvailableUninstall.mockClear();
  });

  it('rejects non-boolean allowAvailableUninstall with 400', async () => {
    const res = await call({ wingetId: 'Contoso.App', allowAvailableUninstall: 'true' });
    expect(res.status).toBe(400);
    expect(state.updateAllowAvailableUninstall).not.toHaveBeenCalled();
  });

  it('rejects allowAvailableUninstall on non-win32LobApp with 400', async () => {
    state.appType = '#microsoft.graph.winGetApp';
    const res = await call({ wingetId: 'Contoso.App', allowAvailableUninstall: true });
    expect(res.status).toBe(400);
    expect(state.updateAllowAvailableUninstall).not.toHaveBeenCalled();
  });

  it('patches Graph and persists allowAvailableUninstall to packaging_jobs and app_update_policies with optimistic updated_at guard read before job save', async () => {
    const res = await call({ wingetId: 'Contoso.App', allowAvailableUninstall: true });
    expect(res.status).toBe(200);
    expect(state.updateAllowAvailableUninstall).toHaveBeenCalledWith(
      'fixture-token',
      '11111111-1111-4111-8111-111111111111',
      true
    );
    expect(state.savedJobConfig?.allowAvailableUninstall).toBe(true);
    expect(state.savedJobConfig?.allowAvailableUninstallSource).toBe('explicit_settings_patch');
    expect(state.savedPolicyConfig?.allowAvailableUninstall).toBe(true);
    expect(state.policyUpdateEqFilters).toContainEqual(['updated_at', state.policyRow.updated_at]);
    expect(state.policyReadOrder.indexOf('policy-read')).toBeLessThan(state.policyReadOrder.indexOf('job-update'));
  });

  it('rolls back only allowAvailableUninstall fields while preserving applied assignments and categories when policy update conflicts', async () => {
    state.policyUpdateConflict = true;
    const newAssignments = [{ type: 'allUsers', intent: 'available' }];
    const newCategories = [{ id: 'cat-1', displayName: 'Productivity' }];
    const res = await call({
      wingetId: 'Contoso.App',
      allowAvailableUninstall: true,
      assignments: newAssignments,
      categories: newCategories,
    });
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(String(body.error)).toMatch(/auto-update policy.*(stale|out of sync|previous value)/i);
    expect(body.policySyncStale).toBe(true);
    // First update wrote the new config; second update rolled back ONLY allowAvailableUninstall fields while keeping assignments/categories
    expect(state.jobUpdates).toHaveLength(2);
    expect(state.jobUpdates[1].payload.package_config).toEqual({
      description: 'Contoso',
      assignments: newAssignments,
      categories: newCategories,
    });
    expect(state.jobUpdates[1].filters).toContainEqual(['updated_at', '2026-11-27T00:01:00.000Z']);
  });
});
