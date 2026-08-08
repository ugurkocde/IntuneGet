import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createServerClientMock,
  createManifestClientMock,
  detectWingetChangesMock,
  resolveManifestMock,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  createManifestClientMock: vi.fn(() => ({ kind: 'manifest-client' })),
  detectWingetChangesMock: vi.fn(),
  resolveManifestMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));
vi.mock('@/lib/qa/winget-changes', () => ({ detectWingetChanges: detectWingetChangesMock }));
vi.mock('@/lib/winget-sync-resolution.mjs', () => ({
  createWingetManifestClient: createManifestClientMock,
  resolveWingetManifest: resolveManifestMock,
}));

import { GET } from './route';

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'limit']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function createSupabaseStub(options: {
  coverage?: number;
  coverageError?: string;
  supportedApps?: Array<Record<string, unknown>>;
  recipes?: Array<Record<string, unknown>>;
}) {
  const pollRunInserts: Array<Record<string, unknown>> = [];
  const pollRunUpdates: Array<Record<string, unknown>> = [];
  const cursorUpdates: Array<Record<string, unknown>> = [];

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'qa_poll_runs') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            pollRunInserts.push(row);
            return query({ data: { id: 'poll-run-1' }, error: null });
          }),
          update: vi.fn((row: Record<string, unknown>) => {
            pollRunUpdates.push(row);
            return query({ data: null, error: null });
          }),
        };
      }
      if (table === 'curated_apps') {
        return {
          select: vi.fn((_columns: string, selectOptions?: { head?: boolean }) =>
            query(
              selectOptions?.head
                ? {
                    data: null,
                    count: options.coverage ?? 14_062,
                    error: options.coverageError ? { message: options.coverageError } : null,
                  }
                : { data: options.supportedApps || [], error: null }
            )
          ),
        };
      }
      if (table === 'qa_winget_poll_state') {
        return {
          select: vi.fn(() => query({ data: { head_sha: 'a'.repeat(40), last_checked_at: null }, error: null })),
          update: vi.fn((row: Record<string, unknown>) => {
            cursorUpdates.push(row);
            return query({ data: null, error: null });
          }),
        };
      }
      if (table === 'qa_recipes') {
        return query({ data: options.recipes || [], error: null });
      }
      if (table === 'app_update_policies' || table === 'qa_results') {
        return query({ data: [], error: null });
      }
      if (table === 'qa_candidates') {
        return {
          insert: vi.fn(() => query({ data: { id: 'candidate-1' }, error: null })),
          update: vi.fn(() => query({ data: null, error: null })),
          select: vi.fn(() => query({ data: null, error: null })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return { client, pollRunInserts, pollRunUpdates, cursorUpdates };
}

function cronRequest(): Request {
  return new Request('https://intuneget.com/api/cron/qa-enqueue', {
    headers: {
      authorization: 'Bearer test-cron-secret',
      'x-vercel-id': 'fra1::request-1',
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.CRON_SECRET = 'test-cron-secret';
  detectWingetChangesMock.mockResolvedValue({
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: 0,
    changedPackageIds: [],
    initialized: false,
  });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe('GET /api/cron/qa-enqueue', () => {
  it('persists a successful full-catalog poll and advances its cursor', async () => {
    const { client, pollRunInserts, pollRunUpdates, cursorUpdates } = createSupabaseStub({});
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      runId: 'poll-run-1',
      coveredApps: 14_062,
      checked: 0,
      errorCount: 0,
    });
    expect(pollRunInserts).toEqual([expect.objectContaining({ request_id: 'fra1::request-1' })]);
    expect(cursorUpdates).toEqual([expect.objectContaining({ head_sha: 'b'.repeat(40) })]);
    expect(pollRunUpdates).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        recipe_count: 14_062,
        changed_package_count: 0,
        supported_changed_count: 0,
      }),
    ]);
  });

  it('records a changed supported app failure without advancing the cursor', async () => {
    detectWingetChangesMock.mockResolvedValue({
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      changedFiles: 2,
      changedPackageIds: ['Example.App'],
      initialized: false,
    });
    const { client, pollRunUpdates, cursorUpdates } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockRejectedValue(new Error('GitHub returned HTTP 503'));

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toMatchObject({
      success: false,
      checked: 1,
      supportedChangedCount: 1,
      errorCount: 1,
      errors: ['Example.App: GitHub returned HTTP 503'],
    });
    expect(cursorUpdates).toHaveLength(0);
    expect(pollRunUpdates[0]).toMatchObject({ status: 'partial', error_count: 1 });
  });

  it('persists systemic catalog failures with a 500 response', async () => {
    const { client, pollRunUpdates } = createSupabaseStub({ coverageError: 'database unavailable' });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.errors).toEqual([
      'system: Could not count the supported QA catalog: database unavailable',
    ]);
    expect(pollRunUpdates[0]).toMatchObject({ status: 'failed', error_count: 1 });
  });
});
