/**
 * Catalog source selector.
 *
 * Returns the active CatalogSource implementation. In Phase 1 this is always
 * the Supabase-backed source (singleton).
 *
 * TODO(Phase 3): branch on isSupabaseConfigured() and return a
 * SnapshotCatalogSource (better-sqlite3 over a downloaded catalog snapshot)
 * for self-hosted sqlite mode when Supabase is not configured.
 */

import type { CatalogSource } from './types';
import { SupabaseCatalogSource } from './supabase-source';

let _source: CatalogSource | null = null;

export function getCatalogSource(): CatalogSource {
  if (!_source) {
    _source = new SupabaseCatalogSource();
  }
  return _source;
}

export type { CatalogSource } from './types';
