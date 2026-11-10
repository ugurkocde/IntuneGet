import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CrossTenantJobsTable } from './CrossTenantJobsTable';
import type { MspJob } from '@/types/msp';
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => ({ getAccessToken: vi.fn() }) }));

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
