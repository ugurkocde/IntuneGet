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

export type AssignmentIntent = PackageAssignment['intent'];

/**
 * Intents an administrator can choose for an included target, in the order
 * they are offered when adding a group and in each assignment row.
 */
export const ASSIGNMENT_INTENT_OPTIONS: ReadonlyArray<{
  value: AssignmentIntent;
  label: string;
  description: string;
}> = [
  {
    value: 'required',
    label: 'Required',
    description: 'Installs automatically on targeted users or devices.',
  },
  {
    value: 'available',
    label: 'Available',
    description: 'Users can install it themselves from Company Portal.',
  },
  {
    value: 'uninstall',
    label: 'Uninstall',
    description: 'Removes the app from targeted users or devices.',
  },
  {
    value: 'updateOnly',
    label: 'Update Only',
    description: 'Updates the app only where it is already installed.',
  },
];

/**
 * Build the assignment for a group picked in the group search. Included groups
 * use the intent chosen before adding them. Exclusions keep the required
 * intent they have always been sent with.
 */
export function buildGroupAssignment(
  group: { id: string; displayName: string },
  mode: 'include' | 'exclude',
  includeIntent: AssignmentIntent
): PackageAssignment {
  return {
    type: mode === 'exclude' ? 'exclusionGroup' : 'group',
    intent: mode === 'exclude' ? 'required' : includeIntent,
    groupId: group.id,
    groupName: group.displayName,
  };
}
