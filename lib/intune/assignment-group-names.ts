import type { AssignmentGroupLookupFailure, IntuneAppAssignment } from '@/types/inventory';

const GROUP_TYPES = new Set([
  '#microsoft.graph.groupAssignmentTarget',
  '#microsoft.graph.exclusionGroupAssignmentTarget',
]);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AssignmentGroupLookup {
  names: Record<string, string>;
  /** Definitive reasons a name could not be read; transient errors are not recorded. */
  failures: Record<string, AssignmentGroupLookupFailure>;
}

/** Resolve optional labels within one tenant request; lookup failures preserve the ID fallback. */
export async function resolveAssignmentGroupNames(
  assignments: IntuneAppAssignment[], token: string, signal: AbortSignal,
): Promise<AssignmentGroupLookup> {
  const ids = [...new Set(assignments.flatMap(({ target }) =>
    GROUP_TYPES.has(target?.['@odata.type']) && typeof target.groupId === 'string' && GUID.test(target.groupId)
      ? [target.groupId.toLowerCase()] : [],
  ))].slice(0, 50);
  const names: Record<string, string> = {};
  const failures: Record<string, AssignmentGroupLookupFailure> = {};
  // One shared deadline bounds the entire optional lookup, including queued requests.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, ids.length) }, async () => {
    while (next < ids.length && !deadline.aborted) {
      const id = ids[next++];
      try {
        const response = await fetch(`https://graph.microsoft.com/v1.0/groups/${id}?$select=id,displayName`, {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: deadline,
        });
        if (response.status !== 200) {
          if (response.status === 404) failures[id] = 'not_found';
          else if (response.status === 401 || response.status === 403) failures[id] = 'access_denied';
          await response.body?.cancel();
          continue;
        }
        const group = await response.json();
        if (typeof group?.id === 'string' && group.id.toLowerCase() === id &&
            typeof group.displayName === 'string' && group.displayName.trim()) {
          names[id] = group.displayName;
        }
      } catch { /* Optional labels never turn a successful app response into a failure. */ }
    }
  }));
  return { names, failures };
}

const FAILURE_LABELS: Record<AssignmentGroupLookupFailure, string> = {
  not_found: 'group deleted or not found',
  access_denied: 'no permission to read group name',
};

export function assignmentTargetLabel(
  target: IntuneAppAssignment['target'],
  names: Record<string, string> = {},
  failures: Partial<Record<string, AssignmentGroupLookupFailure>> = {},
): string {
  const type = target['@odata.type'];
  if (type?.includes('allDevices')) return 'All Devices';
  if (type?.includes('allUsers')) return 'All Users';
  if (!target.groupId) return 'Unknown Target';
  const excluded = type === '#microsoft.graph.exclusionGroupAssignmentTarget';
  const prefix = excluded ? 'Excluded group' : 'Group';
  const id = target.groupId.toLowerCase();
  if (names[id]) return `${prefix}: ${names[id]}`;
  const failure = failures[id];
  const reason = failure ? FAILURE_LABELS[failure] : 'name unavailable';
  return `${prefix}: ${target.groupId.slice(0, 8)}... (${reason})`;
}
