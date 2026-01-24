/**
 * Database Factory
 * Returns the appropriate database adapter based on configuration
 */

import type { DatabaseAdapter } from './types';

// Re-export types
export type { DatabaseAdapter, PackagingJob, UploadHistoryRecord, JobStats } from './types';

// Singleton database instance
let databaseInstance: DatabaseAdapter | null = null;

/**
 * Get the database mode from environment
 */
export function getDatabaseMode(): 'sqlite' | 'supabase' {
  const mode = process.env.DATABASE_MODE?.toLowerCase();

  if (mode === 'sqlite') {
    return 'sqlite';
  }

  // Default to Supabase
  return 'supabase';
}

/**
 * Check if SQLite mode is enabled
 */
export function isSqliteMode(): boolean {
  return getDatabaseMode() === 'sqlite';
}

/**
 * Get the database adapter instance
 * Returns SQLite for self-hosted mode, Supabase for cloud mode
 */
export function getDatabase(): DatabaseAdapter {
  if (databaseInstance) {
    return databaseInstance;
  }

  const mode = getDatabaseMode();

  if (mode === 'sqlite') {
    // Dynamically import SQLite adapter to avoid bundling it in non-SQLite environments
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sqliteDb } = require('./sqlite');
    databaseInstance = sqliteDb;
    console.log('[Database] Using SQLite mode');
  } else {
    // Use Supabase adapter
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { supabaseDb } = require('./supabase-adapter');
    databaseInstance = supabaseDb;
    console.log('[Database] Using Supabase mode');
  }

  return databaseInstance as DatabaseAdapter;
}

/**
 * Reset the database instance (useful for testing)
 */
export function resetDatabaseInstance(): void {
  databaseInstance = null;
}

/**
 * Verify the packager API key for authentication
 */
export function verifyPackagerApiKey(providedKey: string | null): boolean {
  if (!providedKey) {
    return false;
  }

  const mode = getDatabaseMode();

  if (mode === 'sqlite') {
    // In SQLite mode, use the PACKAGER_API_KEY
    const apiKey = process.env.PACKAGER_API_KEY;
    if (!apiKey) {
      console.warn('[Auth] PACKAGER_API_KEY is not set - packager authentication will fail');
      return false;
    }
    return providedKey === apiKey;
  }

  // In Supabase mode, use the service role key (existing behavior)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return providedKey === serviceRoleKey;
}

/**
 * Get the expected auth key for packager communication
 * This is used by the packager to know which key to send
 */
export function getPackagerAuthKey(): string | undefined {
  const mode = getDatabaseMode();

  if (mode === 'sqlite') {
    return process.env.PACKAGER_API_KEY;
  }

  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}
