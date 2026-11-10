/**
 * Selection logic for the hourly hot-package sync cron.
 *
 * Postgres sorts NULL popularity_rank values last in ascending order, so a
 * single ranked query with a limit would never reach newly added apps that
 * have no rank yet. To cover both, we merge the top ranked apps with apps
 * that have never been synced (NULL latest_version).
 *
 * Apps blocked as upstream_removed are re-checked too. The eligibility
 * trigger forces is_verified=false while a block exists, so the verified-only
 * queries would never see them again and a transient WinGet miss would hide
 * the app permanently.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const RANKED_SYNC_LIMIT = 150;
const UNSYNCED_SYNC_LIMIT = 50;
const UPSTREAM_RECHECK_LIMIT = 50;
const APP_COLUMNS = 'winget_id, latest_version, description, upstream_miss_count';

export interface AppToSync {
  winget_id: string;
  latest_version: string | null;
  description: string | null;
  upstream_miss_count: number;
  /** True when the app is currently blocked as upstream_removed. */
  upstream_removed_block?: boolean;
}

export async function selectAppsToSync(
  supabase: SupabaseClient
): Promise<AppToSync[]> {
  // Top ranked apps
  const { data: rankedApps, error: rankedError } = await supabase
    .from('curated_apps')
    .select(APP_COLUMNS)
    .eq('is_verified', true)
    .eq('is_winget_verified', true)
    .eq('app_source', 'win32')
    .order('popularity_rank', { ascending: true })
    .limit(RANKED_SYNC_LIMIT);

  if (rankedError) {
    throw rankedError;
  }

  // Apps that have never been synced (no version data yet)
  const { data: unsyncedApps, error: unsyncedError } = await supabase
    .from('curated_apps')
    .select(APP_COLUMNS)
    .eq('is_verified', true)
    .eq('is_winget_verified', true)
    .eq('app_source', 'win32')
    .is('latest_version', null)
    .order('created_at', { ascending: false })
    .limit(UNSYNCED_SYNC_LIMIT);

  if (unsyncedError) {
    throw unsyncedError;
  }

  const blockedApps = await selectUpstreamRemovedApps(supabase);

  const merged = new Map<string, AppToSync>();
  for (const app of [...blockedApps, ...(rankedApps || []), ...(unsyncedApps || [])]) {
    if (!merged.has(app.winget_id)) {
      merged.set(app.winget_id, app);
    }
  }

  return Array.from(merged.values());
}

async function selectUpstreamRemovedApps(supabase: SupabaseClient): Promise<AppToSync[]> {
  const { data: blocks, error: blocksError } = await supabase
    .from('package_eligibility_blocks')
    .select('winget_id')
    .eq('block_code', 'upstream_removed')
    .order('updated_at', { ascending: true })
    .limit(UPSTREAM_RECHECK_LIMIT);

  if (blocksError) {
    throw blocksError;
  }

  const ids = (blocks || []).map((block: { winget_id: string }) => block.winget_id);
  if (ids.length === 0) return [];

  // Rotate the recheck window whatever the outcome. Without this, blocks whose
  // recheck errors, reports installer_manifest_missing, or whose app row fails
  // the filters below would keep the oldest updated_at forever and starve
  // every block queued behind them.
  const { error: touchError } = await supabase
    .from('package_eligibility_blocks')
    .update({ updated_at: new Date().toISOString() })
    .eq('block_code', 'upstream_removed')
    .in('winget_id', ids);

  if (touchError) {
    throw touchError;
  }

  const { data: apps, error: appsError } = await supabase
    .from('curated_apps')
    .select(APP_COLUMNS)
    .eq('is_winget_verified', true)
    .eq('app_source', 'win32')
    .in('winget_id', ids)
    .limit(UPSTREAM_RECHECK_LIMIT);

  if (appsError) {
    throw appsError;
  }

  return (apps || []).map((app: AppToSync) => ({ ...app, upstream_removed_block: true }));
}
