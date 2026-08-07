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
