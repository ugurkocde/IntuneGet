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
    description: 'Creating PSADT and IntuneWin package',
    minProgress: 20,
    maxProgress: 50,
  },
  {
    id: 'upload',
    label: 'Upload',
    description: 'Uploading to Intune',
    minProgress: 50,
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

export type StageId = 'queued' | 'download' | 'package' | 'upload' | 'finalize';

/**
 * Get the current active stage based on progress percentage
 */
export function getCurrentStage(
  progress: number,
  status: string
): ProgressStage | null {
  // If job is completed or failed, return null (no active stage)
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
 * Get all completed stage IDs based on progress
 */
export function getCompletedStages(progress: number): StageId[] {
  const completed: StageId[] = [];

  for (const stage of PROGRESS_STAGES) {
    if (progress >= stage.maxProgress) {
      completed.push(stage.id as StageId);
    }
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
