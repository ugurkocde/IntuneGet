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
