import { describe, expect, it } from 'vitest';
import { sanitizeAssignmentsForDispatch } from '@/lib/assignment-intents';
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
