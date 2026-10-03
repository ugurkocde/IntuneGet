/**
 * Catalog source selector.
 *
 * Returns the active CatalogSource implementation as a process singleton. The
 * backing store is decided once, on first access, from isSupabaseConfigured():
 *  - configured   -> SupabaseCatalogSource
 *  - not configured (self-hosted sqlite mode) -> SnapshotCatalogSource over a
 *    downloaded/verified catalog snapshot.
 *
 * snapshot-source.ts transitively pulls node:fs and better-sqlite3, so it must
 * never be statically imported here or it would land in the Supabase-mode/edge
 * bundles. Instead it is lazy-loaded via a Proxy that dynamic-imports the
 * module on the first method call.
 */

import type { CatalogSource } from './types';
import { SupabaseCatalogSource } from './supabase-source';
import { isSupabaseConfigured } from '@/lib/supabase';
import { isCuratedPackageId } from '@/lib/curated-catalog/core.mjs';

let _source: CatalogSource | null = null;

/**
 * Returns a CatalogSource whose methods dynamic-import SnapshotCatalogSource on
 * first call, so the native snapshot module is only pulled in for self-hosted
 * sqlite mode (never into Supabase-mode/edge bundles).
 */
function lazySnapshotSource(): CatalogSource {
  let p: Promise<CatalogSource> | null = null;
  const load = () =>
    (p ??= import('./snapshot-source').then((m) => new m.SnapshotCatalogSource()));
  return new Proxy(
    {},
    {
      get:
        (_t, prop) =>
        (...args: unknown[]) =>
          load().then((s) =>
            (s as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string](
              ...args
            )
          ),
    }
  ) as CatalogSource;
}

export function getCatalogSource(): CatalogSource {
  if (!_source) {
    const base = isSupabaseConfigured() ? new SupabaseCatalogSource() : lazySnapshotSource();
    _source = new Proxy(base, {
      get(target, property) {
        if (property === 'getAllLatestVersions' || property === 'getAppsByWingetIds') {
          return async (ids?: string[]) => {
            const ordinary = property === 'getAllLatestVersions'
              ? await target.getAllLatestVersions()
              : await target.getAppsByWingetIds((ids || []).filter(id => !isCuratedPackageId(id)));
            let curated: Awaited<ReturnType<CatalogSource['getAllLatestVersions']>> = [];
            try {
              const { getCuratedLatestVersions } = await import('@/lib/curated-catalog/server');
              curated = getCuratedLatestVersions();
            } catch {
              // An unavailable approval catalog must not interrupt Winget updates.
            }
            const wanted = ids && new Set(ids.map(id => id.toLowerCase()));
            return [...ordinary.filter(app => !isCuratedPackageId(app.winget_id)),
              ...curated.filter(app => !wanted || wanted.has(app.winget_id.toLowerCase()))];
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  return _source;
}

export type { CatalogSource } from './types';
