import {
  buildAvailableUpdatesQueryParams,
  buildAutoUpdateHistoryQueryParams,
  flattenAutoUpdateHistoryPages,
} from '@/hooks/use-updates';
import type { AutoUpdateHistoryResponse } from '@/hooks/use-updates';

describe('use-updates helpers', () => {
  it('builds available updates query params', () => {
    const params = buildAvailableUpdatesQueryParams({
      tenantId: 'tenant-123',
      criticalOnly: true,
      includeDismissed: true,
    });

    expect(params.toString()).toBe(
      'tenant_id=tenant-123&critical_only=true&include_dismissed=true'
    );
  });

  it('builds history query params with pagination', () => {
    const params = buildAutoUpdateHistoryQueryParams(
      {
        tenantId: 'tenant-123',
        wingetId: 'Microsoft.Edge',
        status: 'failed',
      },
      25,
      50
    );

    expect(params.toString()).toBe(
      'tenant_id=tenant-123&winget_id=Microsoft.Edge&status=failed&limit=25&offset=50'
    );
  });

  it('flattens paged history results in order', () => {
    const pages: AutoUpdateHistoryResponse[] = [
      {
        history: [
          {
            id: 'h1',
            policy_id: 'p1',
            packaging_job_id: null,
            from_version: '1.0.0',
            to_version: '1.0.1',
            update_type: 'patch',
            status: 'completed',
            error_message: null,
            triggered_at: '2026-02-01T00:00:00Z',
            completed_at: '2026-02-01T00:01:00Z',
            policy: {
              winget_id: 'Microsoft.Edge',
              tenant_id: 'tenant-1',
            },
          },
        ],
        count: 1,
        hasMore: true,
      },
      {
        history: [
          {
            id: 'h2',
            policy_id: 'p2',
            packaging_job_id: null,
            from_version: '2.0.0',
            to_version: '2.1.0',
            update_type: 'minor',
            status: 'failed',
            error_message: 'boom',
            triggered_at: '2026-02-02T00:00:00Z',
            completed_at: null,
            policy: {
              winget_id: 'Microsoft.Teams',
              tenant_id: 'tenant-1',
            },
          },
        ],
        count: 1,
        hasMore: false,
      },
    ];

    expect(flattenAutoUpdateHistoryPages(pages).map((item) => item.id)).toEqual(['h1', 'h2']);
  });
});
