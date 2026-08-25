import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type PackageEligibilityBlockCode =
  | 'vendor_retired'
  | 'upstream_removed'
  | 'unsupported_managed_install'
  | 'unsupported_managed_uninstall'
  | 'unsupported_installer_source';

export interface PackageEligibilityBlock {
  wingetId: string;
  code: PackageEligibilityBlockCode;
}

export const PACKAGE_UNAVAILABLE_MESSAGE =
  'This app is not available for automated deployment.';

export interface CatalogExclusion {
  wingetId: string;
  reason: string;
}

/**
 * Look up a winget ID on the permanent catalog denylist
 * (public.curated_excluded_apps). Excluded packages never enter
 * curated_apps, so app requests for them can never be fulfilled and
 * must be refused with the recorded reason instead of accepted.
 * Case-insensitive because users often type a differently-cased id.
 */
export async function getCatalogExclusion(
  supabase: SupabaseClient<Database>,
  wingetId: string
): Promise<CatalogExclusion | null> {
  const id = wingetId.trim();
  if (!id) return null;

  const { data, error } = await supabase
    .from('curated_excluded_apps')
    .select('winget_id, reason')
    .ilike('winget_id', id)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not verify package availability: ${error.message}`);
  }

  return data ? { wingetId: data.winget_id, reason: data.reason } : null;
}

export async function getPackageEligibilityBlocks(
  supabase: SupabaseClient<Database>,
  wingetIds: readonly string[]
): Promise<PackageEligibilityBlock[]> {
  const ids = Array.from(
    new Set(wingetIds.map((id) => id.trim()).filter(Boolean))
  );
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('package_eligibility_blocks')
    .select('winget_id, block_code')
    .in('winget_id', ids);
  if (error) {
    throw new Error(`Could not verify package availability: ${error.message}`);
  }

  return (data || []).map((row) => ({
    wingetId: row.winget_id,
    code: row.block_code,
  }));
}
