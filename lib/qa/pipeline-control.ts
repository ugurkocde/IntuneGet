import type { SupabaseClient } from '@supabase/supabase-js';

export interface QaPipelineControl {
  paused: boolean;
  reason: string | null;
  requiredPackagerCommit: string | null;
  schedulerPackagerCommit: string | null;
  schedulerSeenAt: string | null;
  updatedAt: string;
}

export function isQaPackagerReleaseReady(
  control: QaPipelineControl,
  packagerCommit: string
): boolean {
  return !control.requiredPackagerCommit ||
    control.requiredPackagerCommit.toLowerCase() === packagerCommit.trim().toLowerCase();
}

export async function recordQaSchedulerHeartbeat(
  supabase: SupabaseClient,
  packagerCommit: string,
  observedAt: string
): Promise<void> {
  const { error } = await supabase
    .from('qa_pipeline_control')
    .update({
      scheduler_packager_commit: packagerCommit,
      scheduler_seen_at: observedAt,
    })
    .eq('id', 'global');
  if (error) {
    throw new Error(`Could not record the QA scheduler release heartbeat: ${error.message}`);
  }
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
    .select(
      'paused, reason, required_packager_commit, scheduler_packager_commit, scheduler_seen_at, updated_at'
    )
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
    requiredPackagerCommit:
      typeof data.required_packager_commit === 'string' && data.required_packager_commit.trim()
        ? data.required_packager_commit.trim()
        : null,
    schedulerPackagerCommit:
      typeof data.scheduler_packager_commit === 'string' && data.scheduler_packager_commit.trim()
        ? data.scheduler_packager_commit.trim()
        : null,
    schedulerSeenAt:
      typeof data.scheduler_seen_at === 'string' && data.scheduler_seen_at.trim()
        ? data.scheduler_seen_at.trim()
        : null,
    updatedAt: data.updated_at,
  };
}
