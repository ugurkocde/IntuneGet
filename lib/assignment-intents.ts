import type { PackageAssignment } from '@/types/upload';

/**
 * Convert internal-only assignment intents before sending them to a workflow.
 * updateOnly only maps to required when requirement rules accompany the
 * deployment; without them a required intent would install on every targeted
 * device instead of gating to devices that already have the app.
 */
export function sanitizeAssignmentsForDispatch(
  assignments: PackageAssignment[],
  hasRequirementRules: boolean
): PackageAssignment[] {
  if (!hasRequirementRules) {
    return assignments;
  }
  return assignments.map((assignment) =>
    assignment.intent === 'updateOnly'
      ? { ...assignment, intent: 'required' }
      : assignment
  );
}
