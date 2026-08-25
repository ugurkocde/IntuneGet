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
