import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPaths = [
  'supabase/migrations/20260807193111_qa_release_gate.sql',
  'supabase/migrations/20260807205000_qa_candidate_terminal_evidence.sql',
];

describe.each(migrationPaths)('QA candidate migration contract: %s', (migrationPath) => {
  const sql = readFileSync(resolve(process.cwd(), migrationPath), 'utf8');

  it('only clears per-attempt evidence when another retry will run', () => {
    for (const column of ['dispatched_at', 'started_at', 'github_run_id', 'github_run_url']) {
      expect(sql).toContain(
        `${column} = case when normalized_outcome = 'retry' and attempts < 2 then null else ${column} end`
      );
    }
  });

  it('keeps terminal retry exhaustion distinct from a re-queued retry', () => {
    expect(sql).toContain("when normalized_outcome = 'retry' and attempts < 2 then 'queued'");
    expect(sql).toContain("when normalized_outcome = 'retry' then 'error'");
  });
});

describe('QA dispatcher schema contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260807193111_qa_release_gate.sql'),
    'utf8'
  );

  it('defines superseded as terminal and provides its completion timestamp', () => {
    expect(sql).toContain("'error', 'superseded'");
    expect(sql).toContain('finished_at timestamptz');
  });

  it('enforces a non-null integer priority and a single active candidate', () => {
    expect(sql).toContain('priority integer not null default 0');
    expect(sql).toContain('create unique index qa_candidates_single_active_idx');
    expect(sql).toContain("where status in ('dispatched', 'running')");
  });
});

describe('QA live dashboard migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260808165628_qa_live_dashboard.sql'),
    'utf8'
  );

  it('keeps phase writes monotonic and limited to active candidates', () => {
    expect(sql).toContain("status in ('dispatched', 'running')");
    expect(sql).toContain('p_observed_at > phase_updated_at');
    expect(sql).toContain('returns boolean');
  });

  it('preserves User context while stripping public execution provenance', () => {
    expect(sql).toContain("row_data.environment->>'executionContext' = 'User'");
    expect(sql).toContain('test_id = null');
    expect(sql).toContain('github_run_id = null');
  });
});

describe('QA retry phase reset migration contract', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260808182702_clear_qa_retry_phase.sql'),
    'utf8'
  );

  it('clears previous-attempt phase evidence only when a retry is re-queued', () => {
    for (const column of ['phase', 'phase_started_at', 'phase_updated_at']) {
      expect(sql).toContain(
        `${column} = case when normalized_outcome = 'retry' and attempts < 2 then null else ${column} end`
      );
    }
  });
});
