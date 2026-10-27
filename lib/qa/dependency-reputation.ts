import type { SupabaseClient } from '@supabase/supabase-js';
import type { PackagedWingetDependency } from '@/lib/winget-dependencies';
import { loadInstallerSecurityHolds } from '@/lib/qa/installer-security-holds';

// Match qa_vt_dependency_coverage's seven-day, engine-count-v2 contract.
// This is a read-only admission check, never permission to scan or release a hold.
export async function arePackageDependenciesCovered(
  client: SupabaseClient,
  dependencies: readonly Pick<PackagedWingetDependency, 'installerSha256'>[],
  now = Date.now(),
): Promise<boolean> {
  if (!dependencies.length) return true;
  if (dependencies.length > 8 || !Number.isFinite(now)) return false;
  const hashes = dependencies.map(dependency => dependency.installerSha256.toLowerCase());
  if (hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash) || hash === '0'.repeat(64))) return false;
  const uniqueHashes = [...new Set(hashes)];
  const holds = await loadInstallerSecurityHolds(client, uniqueHashes);
  if (uniqueHashes.some(hash => holds.has(hash))) return false;
  const { data, error } = await client.from('catalog_file_reputation')
    .select('sha256,status,malicious,suspicious,total_engines,engine_count_version,checked_at,analyzed_at,retry_after')
    .in('sha256', uniqueHashes);
  if (error) throw new Error('Dependency reputation is unavailable');
  return uniqueHashes.every(hash => {
    const rows = (data ?? []).filter(row => row.sha256 === hash);
    if (rows.length !== 1) return false;
    const row = rows[0];
    const checked = Date.parse(row.checked_at ?? '');
    const analyzed = Date.parse(row.analyzed_at ?? '');
    const expires = Date.parse(row.retry_after ?? '');
    return row.status === 'found' && row.malicious === 0 && row.suspicious === 0 &&
      row.engine_count_version === 2 && Number.isInteger(row.total_engines) &&
      row.total_engines >= 1 && row.total_engines <= 9999 &&
      Number.isFinite(checked) && checked > now - 7 * 86400000 && checked <= now &&
      Number.isFinite(analyzed) && analyzed <= now && Number.isFinite(expires) && expires > now;
  });
}
