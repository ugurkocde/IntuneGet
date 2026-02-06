/**
 * SCCM Migration History Logger
 * Safe async logging for migration history events
 * Failures are logged but don't block main operations
 */

import type { SccmMigrationAction } from '@/types/sccm';

interface HistoryLogEntry {
  migration_id: string;
  user_id: string;
  tenant_id: string;
  action: SccmMigrationAction;
  app_id?: string;
  app_name?: string;
  previous_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  success: boolean;
  error_message?: string;
  affected_count?: number;
}

// Import Supabase client type from database
import type { Database } from '@/types/database';
import type { SupabaseClient as SupabaseClientType } from '@supabase/supabase-js';

// Use the typed Supabase client
type SupabaseClient = SupabaseClientType<Database>;

/**
 * Safely log a migration history entry
 * This function catches all errors and logs them without throwing
 * Use this to ensure history logging doesn't break main operations
 */
export async function logMigrationHistory(
  supabase: SupabaseClient,
  entry: HistoryLogEntry
): Promise<void> {
  try {
    const { error } = await supabase
      .from('sccm_migration_history')
      .insert({
        ...entry,
        created_at: new Date().toISOString(),
      });

    if (error) {
      console.error('[SCCM History] Failed to log history entry:', {
        action: entry.action,
        migrationId: entry.migration_id,
        error: error.message,
      });
    }
  } catch (err) {
    console.error('[SCCM History] Unexpected error logging history:', {
      action: entry.action,
      migrationId: entry.migration_id,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

/**
 * Fire-and-forget history logging
 * Use when you want to log but don't need to wait for completion
 */
export function logMigrationHistoryAsync(
  supabase: SupabaseClient,
  entry: HistoryLogEntry
): void {
  // Don't await - fire and forget
  logMigrationHistory(supabase, entry).catch((err) => {
    console.error('[SCCM History] Async log failed:', err);
  });
}

/**
 * Helper to create a basic success entry
 */
export function createSuccessEntry(
  migrationId: string,
  userId: string,
  tenantId: string,
  action: SccmMigrationAction,
  newValue?: Record<string, unknown>,
  affectedCount?: number
): HistoryLogEntry {
  return {
    migration_id: migrationId,
    user_id: userId,
    tenant_id: tenantId,
    action,
    new_value: newValue,
    success: true,
    affected_count: affectedCount,
  };
}

/**
 * Helper to create an app-specific entry
 */
export function createAppEntry(
  migrationId: string,
  userId: string,
  tenantId: string,
  action: SccmMigrationAction,
  appId: string,
  appName: string,
  previousValue?: Record<string, unknown>,
  newValue?: Record<string, unknown>
): HistoryLogEntry {
  return {
    migration_id: migrationId,
    user_id: userId,
    tenant_id: tenantId,
    action,
    app_id: appId,
    app_name: appName,
    previous_value: previousValue,
    new_value: newValue,
    success: true,
  };
}

/**
 * Helper to create an error entry
 */
export function createErrorEntry(
  migrationId: string,
  userId: string,
  tenantId: string,
  action: SccmMigrationAction,
  errorMessage: string,
  appId?: string,
  appName?: string
): HistoryLogEntry {
  return {
    migration_id: migrationId,
    user_id: userId,
    tenant_id: tenantId,
    action,
    app_id: appId,
    app_name: appName,
    success: false,
    error_message: errorMessage,
  };
}
