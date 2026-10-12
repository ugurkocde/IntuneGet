import { createHash } from 'node:crypto';
import type { createServerClient } from '@/lib/supabase';

export function qaSourceKey(candidate: {
  winget_id: string; version: string; architecture: string;
  installer_url: string; installer_sha256: string;
}): string {
  return createHash('sha256').update(JSON.stringify([
    candidate.winget_id.trim().toLowerCase(), candidate.version.trim(),
    candidate.architecture.toLowerCase(), candidate.installer_url.trim(),
    candidate.installer_sha256.toUpperCase(),
  ])).digest('hex');
}

export async function qaSourceRetryAt(
  supabase: ReturnType<typeof createServerClient>, sourceKey: string,
): Promise<string | null> {
  const { data, error } = await supabase.from('qa_source_backoff')
    .select('next_retry_at').eq('source_key', sourceKey).maybeSingle();
  if (error) throw new Error(`Could not read installer retry schedule: ${error.message}`);
  return data && Date.parse(data.next_retry_at) > Date.now() ? data.next_retry_at : null;
}

export async function qaSourceRetryAtMany(supabase: ReturnType<typeof createServerClient>, keys: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(keys)];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from('qa_source_backoff')
    .select('source_key, next_retry_at').in('source_key', unique).limit(unique.length + 1);
  if (error || (data?.length ?? 0) > unique.length) throw new Error('Could not verify complete installer retry batch');
  const now = Date.now();
  return new Map((data || []).filter(row => Date.parse(row.next_retry_at) > now).map(row => [row.source_key, row.next_retry_at]));
}
