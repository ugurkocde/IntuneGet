import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type InstallerSecurityHolds = ReadonlyMap<string, string>;

// Only the server loads these records. The public queue receives wording and
// the next check time, never the installer hash or internal refusal evidence.
export async function loadInstallerSecurityHolds(client: SupabaseClient<Database>, hashes: string[]): Promise<InstallerSecurityHolds> {
  const normalized = [...new Set(hashes.map(hash => hash.toLowerCase()).filter(hash => /^[a-f0-9]{64}$/.test(hash)))];
  const holds = new Map<string, string>();
  for (let offset = 0; offset < normalized.length; offset += 100) {
    const result = await client.from('qa_installer_security_holds').select('sha256,next_check_at').in('sha256', normalized.slice(offset, offset + 100)).is('released_at', null);
    if (result.error) throw new Error('Installer security eligibility is unavailable');
    for (const row of result.data || []) {
      if (!/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isFinite(Date.parse(row.next_check_at))) throw new Error('Installer security eligibility is invalid');
      holds.set(row.sha256, row.next_check_at);
    }
  }
  return holds;
}
