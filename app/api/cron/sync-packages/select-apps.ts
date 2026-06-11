/**
 * Selection logic for the daily package sync cron.
 *
 * Postgres sorts NULL popularity_rank values last in ascending order, so a
 * single ranked query with a limit would never reach newly added apps that
 * have no rank yet. To cover both, we merge the top ranked apps with apps
 * that have never been synced (NULL latest_version).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const RANKED_SYNC_LIMIT = 150;
const UNSYNCED_SYNC_LIMIT = 50;

export interface AppToSync {
  winget_id: string;
  latest_version: string | null;
  description: string | null;
}

export async function selectAppsToSync(
  supabase: SupabaseClient
): Promise<AppToSync[]> {
  // Top ranked apps
  const { data: rankedApps, error: rankedError } = await supabase
    .from('curated_apps')
    .select('winget_id, latest_version, description')
    .eq('is_verified', true)
    .order('popularity_rank', { ascending: true })
    .limit(RANKED_SYNC_LIMIT);

  if (rankedError) {
    throw rankedError;
  }

  // Apps that have never been synced (no version data yet)
  const { data: unsyncedApps, error: unsyncedError } = await supabase
    .from('curated_apps')
    .select('winget_id, latest_version, description')
    .eq('is_verified', true)
    .is('latest_version', null)
    .order('created_at', { ascending: false })
    .limit(UNSYNCED_SYNC_LIMIT);

  if (unsyncedError) {
    throw unsyncedError;
  }

  const merged = new Map<string, AppToSync>();
  for (const app of [...(rankedApps || []), ...(unsyncedApps || [])]) {
    if (!merged.has(app.winget_id)) {
      merged.set(app.winget_id, app);
    }
  }

  return Array.from(merged.values());
}
