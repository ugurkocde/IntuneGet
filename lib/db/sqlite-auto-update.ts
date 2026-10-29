import type Database from 'better-sqlite3';
import { DEFAULT_SAFETY_CONFIG } from '@/types/update-policies';

/** Run inside the job write transaction so history and policy cannot lag behind it. */
export function syncSqliteAutoUpdate(database: Database.Database, jobId: string): void {
  const row = database.prepare(`
    SELECT h.id, h.policy_id, j.status, j.error_message, j.completed_at, j.updated_at
    FROM packaging_jobs j
    JOIN app_update_policies p ON p.id = j.auto_update_policy_id AND p.user_id = j.user_id AND p.tenant_id = j.tenant_id AND p.winget_id = j.winget_id
    JOIN auto_update_history h ON h.policy_id = p.id AND h.packaging_job_id = j.id
    WHERE j.id = ? AND j.is_auto_update = 1
      AND j.status IN ('deployed', 'duplicate_skipped', 'failed', 'cancelled')
      AND h.status IN ('pending', 'packaging', 'deploying')
  `).get(jobId) as { id: string; policy_id: string; status: string; error_message: string | null; completed_at: string | null; updated_at: string } | undefined;
  if (!row) return;
  const success = row.status === 'deployed' || row.status === 'duplicate_skipped';
  const now = row.completed_at || row.updated_at;
  database.prepare(`UPDATE auto_update_history SET status = ?, completed_at = ?, error_message = ? WHERE id = ?`)
    .run(success ? 'completed' : row.status, now, success ? null : row.error_message || `Job ${row.status}`, row.id);
  if (success) {
    database.prepare('UPDATE app_update_policies SET consecutive_failures = 0, updated_at = ? WHERE id = ?').run(now, row.policy_id);
    database.prepare('DELETE FROM update_check_results WHERE (user_id, tenant_id, winget_id) IN (SELECT user_id, tenant_id, winget_id FROM app_update_policies WHERE id = ?)').run(row.policy_id);
  } else {
    database.prepare(`UPDATE app_update_policies SET last_auto_update_version = NULL,
      consecutive_failures = consecutive_failures + 1,
      is_enabled = CASE WHEN consecutive_failures + 1 >= ? THEN 0 ELSE is_enabled END,
      updated_at = ? WHERE id = ?`).run(DEFAULT_SAFETY_CONFIG.maxConsecutiveFailures, now, row.policy_id);
  }
}
