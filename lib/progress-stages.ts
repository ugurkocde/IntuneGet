/**
 * Progress Stages Configuration
 * Defines the pipeline stages and their progress ranges
 */

export interface ProgressStage {
  id: string;
  label: string;
  description: string;
  minProgress: number;
  maxProgress: number;
}

export const PROGRESS_STAGES: ProgressStage[] = [
  {
    id: 'queued',
    label: 'Queued',
    description: 'Waiting in queue',
    minProgress: 0,
    maxProgress: 5,
  },
  {
    id: 'download',
    label: 'Download',
    description: 'Downloading tools and installer',
    minProgress: 5,
    maxProgress: 20,
  },
  {
    id: 'package',
    label: 'Package',
    description: 'Creating deployment package',
    minProgress: 20,
    maxProgress: 50,
  },
  {
    id: 'test',
    label: 'Test',
    description: 'Testing install/uninstall cycle',
    minProgress: 50,
    maxProgress: 62,
  },
  {
    id: 'authenticate',
    label: 'Auth',
    description: 'Authenticating with Intune',
    minProgress: 62,
    maxProgress: 70,
  },
  {
    id: 'upload',
    label: 'Upload',
    description: 'Uploading to Intune',
    minProgress: 70,
    maxProgress: 90,
  },
  {
    id: 'finalize',
    label: 'Finalize',
    description: 'Completing deployment',
    minProgress: 90,
    maxProgress: 100,
  },
];

export type StageId = 'queued' | 'download' | 'package' | 'test' | 'authenticate' | 'upload' | 'finalize';

/**
 * Get the current active stage based on progress percentage.
 * For failed jobs, returns the stage where the failure occurred.
 */
export function getCurrentStage(
  progress: number,
  status: string,
  errorStage?: string | null
): ProgressStage | null {
  // For failed jobs with a known error stage, return that stage
  if (status === 'failed' && errorStage) {
    return getFailedStage(errorStage) || null;
  }

  // If job is completed or failed (without error stage), return null
  if (['completed', 'deployed', 'failed'].includes(status)) {
    return null;
  }

  // Find the stage that contains the current progress
  for (const stage of PROGRESS_STAGES) {
    if (progress >= stage.minProgress && progress < stage.maxProgress) {
      return stage;
    }
  }

  // Edge case: exactly 100%
  if (progress >= 100) {
    return PROGRESS_STAGES[PROGRESS_STAGES.length - 1];
  }

  return PROGRESS_STAGES[0];
}

/**
 * Get all completed stage IDs based on progress.
 * For failed jobs, returns stages completed before the failure point.
 */
export function getCompletedStages(
  progress: number,
  status?: string,
  errorStage?: string | null
): StageId[] {
  // For failed jobs with a known error stage, return stages before the failure
  if (status === 'failed' && errorStage) {
    return getCompletedStagesBeforeFailure(errorStage);
  }

  const completed: StageId[] = [];

  for (const stage of PROGRESS_STAGES) {
    if (progress >= stage.maxProgress) {
      completed.push(stage.id as StageId);
    }
  }

  return completed;
}

/**
 * Get the stage where a failure occurred based on error_stage value
 */
export function getFailedStage(errorStage: string): ProgressStage | undefined {
  return PROGRESS_STAGES.find((stage) => stage.id === errorStage);
}

/**
 * Get all stage IDs that were completed before the failure point
 */
export function getCompletedStagesBeforeFailure(errorStage: string): StageId[] {
  const completed: StageId[] = [];

  for (const stage of PROGRESS_STAGES) {
    if (stage.id === errorStage) {
      break;
    }
    completed.push(stage.id as StageId);
  }

  return completed;
}

/**
 * Get stage by ID
 */
export function getStageById(id: StageId): ProgressStage | undefined {
  return PROGRESS_STAGES.find((stage) => stage.id === id);
}

/**
 * Calculate progress within current stage (0-100)
 */
export function getStageProgress(progress: number): number {
  const stage = PROGRESS_STAGES.find(
    (s) => progress >= s.minProgress && progress < s.maxProgress
  );

  if (!stage) {
    return progress >= 100 ? 100 : 0;
  }

  const range = stage.maxProgress - stage.minProgress;
  const progressInStage = progress - stage.minProgress;
  return Math.round((progressInStage / range) * 100);
}
