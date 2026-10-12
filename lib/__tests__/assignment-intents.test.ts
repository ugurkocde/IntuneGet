import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_INTENT_OPTIONS,
  buildGroupAssignment,
  sanitizeAssignmentsForDispatch,
} from '@/lib/assignment-intents';
import type { PackageAssignment } from '@/types/upload';

describe('sanitizeAssignmentsForDispatch', () => {
  it('maps updateOnly to required while preserving all other fields and intents', () => {
    const assignments: PackageAssignment[] = [
      {
        type: 'group',
        intent: 'updateOnly',
        groupId: 'group-1',
        groupName: 'Pilot devices',
        filterId: 'filter-1',
        filterName: 'Windows 11',
        filterType: 'include',
        notifications: 'hideAll',
        deliveryOptimizationPriority: 'foreground',
      },
      { type: 'allUsers', intent: 'available', notifications: 'showAll' },
      { type: 'allDevices', intent: 'uninstall' },
    ];

    expect(sanitizeAssignmentsForDispatch(assignments, true)).toEqual([
      { ...assignments[0], intent: 'required' },
      assignments[1],
      assignments[2],
    ]);
  });

  it('leaves updateOnly untouched when no requirement rules accompany the deployment', () => {
    const assignments: PackageAssignment[] = [
      { type: 'group', intent: 'updateOnly', groupId: 'group-1' },
    ];

    expect(sanitizeAssignmentsForDispatch(assignments, false)).toEqual(assignments);
  });
});

describe('buildGroupAssignment', () => {
  const group = { id: 'group-1', displayName: 'Pilot devices' };

  it('uses the chosen intent for included groups', () => {
    expect(buildGroupAssignment(group, 'include', 'available')).toEqual({
      type: 'group',
      intent: 'available',
      groupId: 'group-1',
      groupName: 'Pilot devices',
    });
    expect(buildGroupAssignment(group, 'include', 'uninstall').intent).toBe('uninstall');
  });

  it('keeps exclusions on the required intent regardless of the chosen intent', () => {
    expect(buildGroupAssignment(group, 'exclude', 'available')).toEqual({
      type: 'exclusionGroup',
      intent: 'required',
      groupId: 'group-1',
      groupName: 'Pilot devices',
    });
  });
});

describe('ASSIGNMENT_INTENT_OPTIONS', () => {
  it('lists every intent the assignment payload supports', () => {
    expect(ASSIGNMENT_INTENT_OPTIONS.map((option) => option.value)).toEqual([
      'required',
      'available',
      'uninstall',
      'updateOnly',
    ]);
  });
});
