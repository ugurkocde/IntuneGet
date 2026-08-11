import type { SupabaseClient } from '@supabase/supabase-js';

export interface QaPipelineControl {
  paused: boolean;
  reason: string | null;
  updatedAt: string;
}

/**
 * Read the singleton maintenance control. Missing or unreadable state is an
 * error rather than an implicit resume: the one-VM pipeline must fail closed
 * when operators cannot prove that maintenance has ended.
 */
export async function getQaPipelineControl(
  supabase: SupabaseClient
): Promise<QaPipelineControl> {
  const { data, error } = await supabase
    .from('qa_pipeline_control')
    .select('paused, reason, updated_at')
    .eq('id', 'global')
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read QA pipeline maintenance control: ${error.message}`);
  }
  if (!data) {
    throw new Error('QA pipeline maintenance control is missing.');
  }

  return {
    paused: data.paused === true,
    reason: typeof data.reason === 'string' && data.reason.trim()
      ? data.reason.trim()
      : null,
    updatedAt: data.updated_at,
  };
}
