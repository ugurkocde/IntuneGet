/**
 * Test Sub-Steps Configuration
 * Defines the 5 sub-steps of the package test phase and provides
 * parsing utilities for the [test:N/5] convention in status_message.
 */

export interface TestSubStep {
  id: string;
  index: number;
  label: string;
  description: string;
}

export type SubStepStatus = 'completed' | 'active' | 'pending' | 'failed';

export const TEST_SUBSTEPS: TestSubStep[] = [
  { id: 'structure', index: 1, label: 'Structure', description: 'Validating package structure' },
  { id: 'install', index: 2, label: 'Install', description: 'Running silent install' },
  { id: 'detect', index: 3, label: 'Detect', description: 'Verifying detection rules' },
  { id: 'uninstall', index: 4, label: 'Uninstall', description: 'Running silent uninstall' },
  { id: 'verify', index: 5, label: 'Verify', description: 'Verifying clean removal' },
];

/**
 * Parse the active test step number from a status message.
 * Expects format: "[test:N/5] ..." where N is 1-5.
 * Returns the step number or null if not found.
 */
export function parseTestStep(statusMessage: string | null | undefined): number | null {
  if (!statusMessage) return null;
  const match = statusMessage.match(/^\[test:(\d+)\/5\]/);
  if (!match) return null;
  const step = parseInt(match[1], 10);
  if (step < 1 || step > 5) return null;
  return step;
}

/**
 * Compute the status of each sub-step based on the active step,
 * whether the job has failed, and whether testing is complete.
 */
export function getSubStepStatuses(
  activeStep: number | null,
  isJobFailed: boolean,
  isTestComplete: boolean
): SubStepStatus[] {
  // All completed (test passed, no prefix in message)
  if (isTestComplete) {
    return TEST_SUBSTEPS.map(() => 'completed');
  }

  // No step parsed yet -- all pending
  if (activeStep === null) {
    return TEST_SUBSTEPS.map(() => 'pending');
  }

  return TEST_SUBSTEPS.map((step) => {
    if (step.index < activeStep) return 'completed';
    if (step.index === activeStep) return isJobFailed ? 'failed' : 'active';
    return 'pending';
  });
}
