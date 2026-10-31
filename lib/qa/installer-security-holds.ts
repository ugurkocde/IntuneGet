import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export interface InstallerSecurityHold { nextCheckAt: string; reason: string }
export type InstallerSecurityHolds = ReadonlyMap<string, InstallerSecurityHold>;
export function installerSecurityReason(malicious: number): string {
  if (malicious === 0) return 'VirusTotal: awaiting engine coverage, rechecking daily';
  return malicious === 1 ? 'VirusTotal: 1 engine flagged, rechecking daily' : 'VirusTotal refused execution for this installer hash.';
}

// Only the server loads these records. The public queue receives wording and
// the next check time, never the installer hash or internal refusal evidence.
export async function loadInstallerSecurityHolds(client: SupabaseClient<Database>, hashes: string[]): Promise<InstallerSecurityHolds> {
  const normalized = [...new Set(hashes.map(hash => hash.toLowerCase()).filter(hash => /^[a-f0-9]{64}$/.test(hash)))];
  const holds = new Map<string, InstallerSecurityHold>();
  for (let offset = 0; offset < normalized.length; offset += 100) {
    const result = await client.from('qa_installer_security_holds').select('sha256,next_check_at,malicious_verdicts').in('sha256', normalized.slice(offset, offset + 100)).is('released_at', null);
    if (result.error || !Array.isArray(result.data)) throw new Error('Installer security eligibility is unavailable');
    for (const row of result.data) {
      if (typeof row.sha256 !== 'string' || row.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isFinite(Date.parse(row.next_check_at)) || !Number.isInteger(row.malicious_verdicts) || row.malicious_verdicts < 0 || row.malicious_verdicts > 9999) throw new Error('Installer security eligibility is invalid');
      holds.set(row.sha256, { nextCheckAt: row.next_check_at, reason: installerSecurityReason(row.malicious_verdicts) });
    }
  }
  return holds;
}
