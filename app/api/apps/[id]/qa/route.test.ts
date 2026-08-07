import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getQaResultMock, applyRateLimitMock } = vi.hoisted(() => ({
  getQaResultMock: vi.fn(),
  applyRateLimitMock: vi.fn(),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({ getQaResult: getQaResultMock }),
}));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: applyRateLimitMock,
  getIpKey: () => 'ip:test',
  PUBLIC_RATE_LIMIT: { limit: 30, windowMs: 60_000 },
}));

import { GET } from './route';

const row = {
  winget_id: 'OpenJS.NodeJS',
  display_name: 'Node.js',
  publisher: 'OpenJS Foundation',
  tested_version: '26.7.0',
  architecture: 'x64',
  outcome: 'Passed',
  tested_at_utc: '2026-08-07T12:00:00Z',
  overall_duration_seconds: 20,
  installer_type: 'msi',
  install_command: 'msiexec /i node.msi /qn',
  uninstall_command: 'msiexec /x {PRODUCT} /qn',
  detection: { type: 'fileVersion', path: 'C:\\Program Files\\nodejs\\node.exe', minimumVersion: '26.7.0' },
  phase_results: {
    install: { exitCode: 0, durationSeconds: 1, timedOut: false },
    detectionAfterInstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
    uninstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
    detectionAfterUninstall: { exitCode: 1, durationSeconds: 1, timedOut: false },
  },
  changes: null,
  relevant_event_count: 0,
  environment: { executionContext: 'LocalSystem' },
};

describe('GET /api/apps/[id]/qa', () => {
  beforeEach(() => {
    getQaResultMock.mockReset();
    applyRateLimitMock.mockReset().mockResolvedValue(null);
  });

  it('returns commands and compact evidence without private run provenance', async () => {
    getQaResultMock.mockResolvedValue(row);
    const response = await GET(new NextRequest('http://localhost/api/apps/OpenJS.NodeJS/qa'), {
      params: Promise.resolve({ id: 'OpenJS.NodeJS' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.commands.install).toContain('/qn');
    expect(body.environment).toEqual({ executionContext: 'LocalSystem' });
    expect(JSON.stringify(body)).not.toMatch(/runUrl|runId|runAttempt|testId|computerName|executedAs/);
    expect(body.classification).toBeNull();
  });

  it('returns 404 for an untested app', async () => {
    getQaResultMock.mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/api/apps/Mozilla.Firefox/qa'), {
      params: Promise.resolve({ id: 'Mozilla.Firefox' }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 400 for malformed percent encoding', async () => {
    const response = await GET(new NextRequest('http://localhost/api/apps/%E0%A4%A/qa'), {
      params: Promise.resolve({ id: '%E0%A4%A' }),
    });
    expect(response.status).toBe(400);
    expect(getQaResultMock).not.toHaveBeenCalled();
  });
});
