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

export type PackageCompatibilityBlockCode =
  Database['public']['Tables']['qa_package_blocks']['Row']['block_code'];

export interface PackageCompatibilityBlock {
  wingetId: string;
  version: string;
  architecture: 'x64' | 'x86' | 'arm64';
  installerSha256: string;
  code: PackageCompatibilityBlockCode;
  detail: string;
}

export const PACKAGE_UNAVAILABLE_MESSAGE =
  'This app is not available for automated deployment.';

export const PACKAGE_VERSION_UNAVAILABLE_MESSAGE =
  'This app version is not available for automated deployment.';

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

/**
 * Look up a reviewed compatibility block for one immutable installer payload.
 * Exact tuple matching prevents a bad vendor release from reaching either QA
 * or customer packaging without disabling a future corrected release.
 */
export async function getPackageCompatibilityBlock(
  supabase: SupabaseClient<Database>,
  input: {
    wingetId: string;
    version: string;
    architecture: string;
    installerSha256: string;
  }
): Promise<PackageCompatibilityBlock | null> {
  const architecture = input.architecture.trim().toLowerCase();
  const installerSha256 = input.installerSha256.trim().toUpperCase();
  if (
    !input.wingetId.trim() ||
    !input.version.trim() ||
    !['x64', 'x86', 'arm64'].includes(architecture) ||
    !/^[A-F0-9]{64}$/.test(installerSha256)
  ) {
    return null;
  }

  const { data, error } = await supabase
    .from('qa_package_blocks')
    .select('winget_id, version, architecture, installer_sha256, block_code, detail')
    .eq('winget_id', input.wingetId.trim())
    .eq('version', input.version.trim())
    .eq('architecture', architecture as 'x64' | 'x86' | 'arm64')
    .eq('installer_sha256', installerSha256)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not verify package compatibility: ${error.message}`);
  }

  return data
    ? {
        wingetId: data.winget_id,
        version: data.version,
        architecture: data.architecture,
        installerSha256: data.installer_sha256,
        code: data.block_code,
        detail: data.detail,
      }
    : null;
}
