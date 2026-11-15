import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { packageJobStatuses } from '@/lib/package-callback';
import { CrossTenantJobsTable } from './CrossTenantJobsTable';
import type { MspJob } from '@/types/msp';

vi.mock('@/hooks/useMicrosoftAuth', () => ({
  useMicrosoftAuth: () => ({ getAccessToken: vi.fn() }),
}));

const job: MspJob = {
  id: 'job-fixture', tenant_id: 'tenant-fixture', tenant_display_name: 'Test tenant',
  winget_id: 'Test.App', display_name: 'Test app', publisher: null, version: '1.0',
  status: 'queued', status_message: null, progress_percent: 0, error_message: null,
  intune_app_id: null, intune_app_url: null, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', completed_at: null,
};

const presentation = {
  queued: ['Queued', 'lucide-clock', 'text-text-muted'],
  packaging: ['Packaging', 'lucide-loader', 'text-accent-cyan'],
  uploading: ['Uploading', 'lucide-loader', 'text-accent-cyan'],
  completed: ['Completed', 'lucide-circle-check', 'text-green-500'],
  deployed: ['Deployed', 'lucide-circle-check', 'text-green-500'],
  failed: ['Failed', 'lucide-circle-x', 'text-red-500'],
  cancelled: ['Cancelled', 'lucide-circle-x', 'text-text-muted'],
  duplicate_skipped: ['Already deployed', 'lucide-circle-check', 'text-green-500'],
  configuring: ['Configuring', 'lucide-loader', 'text-accent-cyan'],
  qa_failed: ['Deployment stopped', 'lucide-circle-x', 'text-red-500'],
  blocked_upstream: ['Blocked upstream', 'lucide-clock', 'text-accent-violet'],
  awaiting_qa: ['Testing app', 'lucide-clock', 'text-accent-violet'],
} as const;

describe('MSP job status presentation', () => {
  it('covers every package callback status', () => {
    expect(packageJobStatuses.every(status => status in presentation)).toBe(true);
  });
  it.each(Object.entries(presentation))('renders %s with a readable label and matching icon', (status, [label, icon, color]) => {
    const html = renderToStaticMarkup(createElement(CrossTenantJobsTable, { jobs: [{ ...job, status }] }));
    const statusCell = html.split('<td')[3].split('</td>')[0];
    expect(statusCell).toContain(`>${label}</span>`);
    expect(statusCell).toContain(icon);
    expect(statusCell).toContain(color);
  });
});

describe('MSP blocked upstream reason', () => {
  it.each(['UPSTREAM_SOURCE_BACKOFF', 'UPSTREAM_METADATA_MISMATCH', 'https://private.invalid/hash'])('renders fixed copy for %s without private evidence', code => {
    const job = { id: 'fake-job', status: 'blocked_upstream', error_code: code,
      error_message: 'private producer message with hash', status_message: 'private producer detail',
      display_name: 'Example', winget_id: 'Vendor.App', version: '1', tenant_display_name: 'Example tenant',
      created_at: '2026-10-18T00:00:00Z', intune_app_url: null } as unknown as MspJob;
    const html = renderToStaticMarkup(createElement(CrossTenantJobsTable, { jobs: [job] }));
    expect(html).toContain(code === 'UPSTREAM_SOURCE_BACKOFF'
      ? 'Installer source checks are deferred. Next event: a scheduled source check.'
      : 'Validation status is temporarily unavailable. Next event: updated validation information.');
    expect(html).not.toContain('private');
    expect(html).not.toContain('UPSTREAM_');
  });
});

describe('MSP validation stops', () => {
  it.each([
    'Security checks stopped this request before installation testing.',
    'The requested app version is unavailable.',
    'Installation exited with an error.',
    null,
  ])('does not infer an installation test outcome from qa_failed: %s', errorMessage => {
    const job = { id: 'fake-job', status: 'qa_failed', error_message: errorMessage,
      display_name: 'Example', winget_id: 'Vendor.App', version: '1', tenant_display_name: 'Example tenant',
      created_at: '2026-10-18T00:00:00Z', intune_app_url: 'https://example.invalid/app' } as unknown as MspJob;
    const stored = { ...job };
    const html = renderToStaticMarkup(createElement(CrossTenantJobsTable, { jobs: [job] }));
    expect(html).toContain('Deployment stopped');
    expect(html).not.toContain('Installation test failed');
    if (errorMessage) expect(html).toContain(errorMessage);
    expect(html).toContain('href="https://example.invalid/app"');
    expect(job).toEqual(stored);
  });

  it.each([['failed', 'Failed'], ['completed', 'Completed']])('preserves the %s label', (status, label) => {
    const job = { id: 'fake-job', status, display_name: 'Example', winget_id: 'Vendor.App', version: '1',
      tenant_display_name: 'Example tenant', created_at: '2026-10-18T00:00:00Z', intune_app_url: null } as unknown as MspJob;
    const html = renderToStaticMarkup(createElement(CrossTenantJobsTable, { jobs: [job] }));
    expect(html).toContain(`>${label}</span>`);
    expect(html).not.toContain('Deployment stopped');
  });
});
