import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => {
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('DATABASE_MODE', 'sqlite');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
  return { authenticated: true, cancel: vi.fn(), readRun: vi.fn() };
});
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => state.authenticated
    ? { userId: 'fixture-owner', userEmail: 'fixture@example.test' } : null,
}));
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return { ...actual, createServerClient: vi.fn(actual.createServerClient) };
});
vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: () => true,
  cancelWorkflowRun: state.cancel, getWorkflowRun: state.readRun,
  UNSTARTED_WORKFLOW_RUN_STATUSES: ['queued', 'waiting', 'pending', 'requested'],
}));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: vi.fn() }));
vi.mock('@/lib/db', async () => {
  const { sqliteDb } = await vi.importActual<typeof import('@/lib/db/sqlite')>('@/lib/db/sqlite');
  return { getDatabase: () => sqliteDb, isSqliteMode: () => true };
});

import { sqliteDb, closeSqliteDb } from '@/lib/db/sqlite';
import { createServerClient } from '@/lib/supabase';
import { POST } from './route';

const call = (body: Record<string, unknown>) => POST(new NextRequest('http://localhost/api/package/cancel', {
  method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}));
const create = (status: string, userId = 'fixture-owner') => sqliteDb.jobs.create({
  id: randomUUID(), user_id: userId, winget_id: 'Fixture.Dismiss', version: '1.0',
  display_name: 'Dismiss fixture', installer_type: 'msi',
  installer_url: 'https://fixture.invalid/installer.msi', status,
});

describe('terminal dismissal with the SQLite adapter', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterAll(() => { closeSqliteDb(); vi.unstubAllEnvs(); });

  for (const status of ['failed', 'completed', 'qa_failed', 'cancelled', 'duplicate_skipped', 'deployed']) {
    it(`archives an owned ${status} job without Supabase and retains the row`, async () => {
      const job = await create(status);
      const response = await call({ jobId: job.id, dismiss: true });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ success: true, archived: true, jobId: job.id });
      const retained = await sqliteDb.jobs.getById(job.id);
      expect(retained?.status).toBe(status);
      expect(retained?.archived_at).toBeTruthy();
      expect((await sqliteDb.jobs.getByUserId('fixture-owner')).some(row => row.id === job.id)).toBe(false);
      expect(createServerClient).not.toHaveBeenCalled();
      expect(state.cancel).not.toHaveBeenCalled();
      expect(state.readRun).not.toHaveBeenCalled();
    });
  }

  it('refuses another owner and keeps that terminal row visible', async () => {
    const job = await create('failed', 'other-fixture-owner');
    expect((await call({ jobId: job.id, dismiss: true })).status).toBe(403);
    expect((await sqliteDb.jobs.getById(job.id))?.archived_at).toBeNull();
  });
  it('returns not found for an absent job', async () => {
    expect((await call({ jobId: randomUUID(), dismiss: true })).status).toBe(404);
  });
  it('requires authentication before reading or archiving a job', async () => {
    const job = await create('failed');
    state.authenticated = false;
    try { expect((await call({ jobId: job.id, dismiss: true })).status).toBe(401); }
    finally { state.authenticated = true; }
    expect((await sqliteDb.jobs.getById(job.id))?.archived_at).toBeNull();
  });
  it('repeated dismissal preserves the original archive timestamp', async () => {
    const job = await create('failed');
    expect((await call({ jobId: job.id, dismiss: true })).status).toBe(200);
    const archivedAt = (await sqliteDb.jobs.getById(job.id))?.archived_at;
    expect((await call({ jobId: job.id, dismiss: true })).status).toBe(200);
    expect((await sqliteDb.jobs.getById(job.id))?.archived_at).toBe(archivedAt);
  });
  it('retains linked upload history and the terminal error and app identity', async () => {
    const job = await create('failed');
    await sqliteDb.jobs.update(job.id, { error_message: 'Fixture failure', intune_app_id: 'fixture-app' });
    const history = await sqliteDb.uploadHistory.create({
      packaging_job_id: job.id, user_id: 'fixture-owner', winget_id: 'Fixture.Dismiss',
      version: '1.0', display_name: 'Dismiss fixture', intune_app_id: 'fixture-app',
      intune_tenant_id: 'fixture-tenant',
    });
    expect((await call({ jobId: job.id, dismiss: true })).status).toBe(200);
    expect(await sqliteDb.jobs.getById(job.id)).toMatchObject({
      status: 'failed', error_message: 'Fixture failure', intune_app_id: 'fixture-app',
    });
    expect((await sqliteDb.uploadHistory.getByUserId('fixture-owner')).some(row =>
      row.id === history.id && row.packaging_job_id === job.id)).toBe(true);
  });
  for (const status of ['queued', 'awaiting_qa']) {
    it(`does not cancel or detach an active ${status} fixture before the unsupported client path fails`, async () => {
      const job = await create(status);
      if (status === 'queued') await sqliteDb.jobs.update(job.id, { github_run_id: '42' });
      for (const dismiss of [false, true]) {
        expect((await call({ jobId: job.id, dismiss })).status).toBe(500);
        expect((await sqliteDb.jobs.getById(job.id))?.status).toBe(status);
        expect((await sqliteDb.jobs.getById(job.id))?.archived_at).toBeNull();
        expect(state.cancel).not.toHaveBeenCalled();
        expect(state.readRun).not.toHaveBeenCalled();
      }
    });
  }
});
