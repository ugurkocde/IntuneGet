import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

interface Schedule { demand: boolean; eligibleAt: string; malicious: number }

// This projection is deliberately separate from the dispatch/security loaders.
export async function loadSecurityRecheckSchedule(client: SupabaseClient<Database>, hashes: string[]) {
  const normalized = [...new Set(hashes.map(hash => hash.toLowerCase()))];
  const schedules = new Map<string, Schedule>();
  if (!normalized.length) return schedules;
  if (normalized.length > 1010 || normalized.some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Installer security schedule is invalid');
  const result = await client.rpc('qa_installer_security_recheck_schedule', { p_sha256: normalized });
  if (result.error || !Array.isArray(result.data)) throw new Error('Installer security schedule is unavailable');
  for (const row of result.data) {
    if (!normalized.includes(row.sha256) || schedules.has(row.sha256) || typeof row.demand !== 'boolean' ||
        !Number.isFinite(Date.parse(row.eligible_at)) || !Number.isInteger(row.malicious) || row.malicious < 0 || row.malicious > 9999) {
      throw new Error('Installer security schedule is invalid');
    }
    schedules.set(row.sha256, { demand: row.demand, eligibleAt: row.eligible_at, malicious: row.malicious });
  }
  if (schedules.size !== normalized.length) throw new Error('Installer security schedule is unavailable');
  return schedules;
}

export function publicSecurityRecheck(schedule: Schedule, now: Date) {
  const due = Date.parse(schedule.eligibleAt) <= now.getTime();
  const reason = schedule.malicious === 0 ? 'VirusTotal: awaiting engine coverage.' :
    schedule.malicious === 1 ? 'VirusTotal: 1 engine flagged.' : 'VirusTotal refused execution for this installer hash.';
  const cadence = schedule.demand ? 'Rechecks are daily while a customer waits for this version.' :
    'Rechecks are weekly until a customer waits for this version.';
  return {
    securityReason: `${reason} ${cadence} ${due ? 'The next recheck is due and waits for a QA test.' : 'A recheck becomes eligible after the scheduled time.'}`,
    nextCheckAt: due ? null : schedule.eligibleAt,
  };
}
