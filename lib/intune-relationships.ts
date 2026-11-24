import type { AppRelationship } from '@/types/intune';

const BASE = 'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/';
const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Edge = Record<string, unknown> & { targetId: string; targetType?: string };
export class RelationshipUpdateError extends Error {
  constructor(public kind: 'invalid' | 'approval_pending' | 'rejected' | 'conflict' | 'readback_mismatch', public mayHaveApplied = false) {
    super('Could not update app relationships. Refresh the app before trying again.');
  }
}
const key = (x: Edge) => `${x['@odata.type']}:${x.targetId.toLowerCase()}`;
const signature = (x: Edge) => `${key(x)}:${x.dependencyType ?? x.supersedenceType ?? ''}`;
function edge(x: AppRelationship): Edge {
  return x.relationshipType === 'dependency'
    ? { '@odata.type': '#microsoft.graph.mobileAppDependency', targetId: x.targetId, dependencyType: x.dependencyType ?? 'autoInstall' }
    : { '@odata.type': '#microsoft.graph.mobileAppSupersedence', targetId: x.targetId, supersedenceType: x.supersedenceType ?? 'update' };
}
export function validateRelationships(value: unknown, appId: string): asserts value is AppRelationship[] {
  if (!GUID.test(appId) || !Array.isArray(value) || value.length > 100) throw new RelationshipUpdateError('invalid');
  const seen = new Set<string>();
  for (const x of value) {
    if (!x || typeof x !== 'object' || typeof x.targetId !== 'string' || !GUID.test(x.targetId) || x.targetId.toLowerCase() === appId.toLowerCase()
      || !['dependency', 'supersedence'].includes(x.relationshipType)
      || (x.relationshipType === 'dependency' && x.dependencyType !== undefined && !['detect', 'autoInstall'].includes(x.dependencyType))
      || (x.relationshipType === 'supersedence' && x.supersedenceType !== undefined && !['update', 'replace'].includes(x.supersedenceType))) throw new RelationshipUpdateError('invalid');
    const k = key(edge(x));
    if (seen.has(k)) throw new RelationshipUpdateError('invalid');
    seen.add(k);
  }
}

/** Change only the saved baseline's outgoing edges; retain portal and automatic edges. */
export function computeRelationshipUpdate(live: Edge[], baseline: AppRelationship[], desired: AppRelationship[]): Edge[] {
  const outgoing = live.filter(x => x.targetType === 'child');
  const next = new Map(outgoing.map(x => [key(x), x]));
  const before = new Map(baseline.map(x => [key(edge(x)), edge(x)]));
  const after = new Map(desired.map(x => [key(edge(x)), edge(x)]));
  for (const [k, old] of before) {
    const actual = next.get(k);
    // Out-of-band edits must be reconciled, never resurrected or overwritten.
    if (!actual || signature(actual) !== signature(old)) throw new RelationshipUpdateError('conflict');
    if (!after.has(k)) next.delete(k);
  }
  for (const [k, wanted] of after) {
    const previous = before.get(k);
    if (!previous || signature(previous) !== signature(wanted)) {
      const actual = next.get(k);
      if (!previous && actual && signature(actual) !== signature(wanted)) throw new RelationshipUpdateError('conflict');
      next.set(k, { ...wanted, ...(actual?.id ? { id: actual.id } : {}) });
    }
  }
  return [...next.values()].map(x => ({ '@odata.type': x['@odata.type'], targetId: x.targetId,
    ...(x.id ? { id: x.id } : {}), ...(x.dependencyType ? { dependencyType: x.dependencyType } : {}),
    ...(x.supersedenceType ? { supersedenceType: x.supersedenceType } : {}) }));
}

export async function syncAppRelationships(token: string, appId: string, baseline: AppRelationship[], desired: AppRelationship[]): Promise<AppRelationship[]> {
  validateRelationships(desired, appId);
  validateRelationships(baseline, appId);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.headers.get('x-msft-approval-code')) throw new RelationshipUpdateError('approval_pending', init.method === 'POST');
    return response;
  };
  const canonical: AppRelationship[] = [];
  for (const item of desired) {
    const response = await request(`${BASE}${item.targetId}?$select=id,displayName,displayVersion`);
    if (response.status === 404) throw new RelationshipUpdateError('invalid');
    if (!response.ok) throw new RelationshipUpdateError('rejected');
    const target = await response.json();
    if (typeof target.id !== 'string' || target.id.toLowerCase() !== item.targetId.toLowerCase()) throw new RelationshipUpdateError('invalid');
    canonical.push({ ...item, targetDisplayName: target.displayName ?? '', targetVersion: target.displayVersion ?? undefined });
  }
  const list = async (): Promise<Edge[]> => {
    const rows: Edge[] = [];
    const path = `${BASE}${appId}/relationships`;
    let url: string | undefined = path;
    for (let page = 0; url && page < 10; page++) {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://graph.microsoft.com' || parsed.pathname !== new URL(path).pathname) throw new RelationshipUpdateError('rejected');
      const response = await request(url);
      if (!response.ok) throw new RelationshipUpdateError('rejected');
      const body = await response.json();
      if (!Array.isArray(body.value) || body.value.some((x: Edge) => typeof x.targetId !== 'string' || !GUID.test(x.targetId) || !['child', 'parent'].includes(x.targetType ?? '')
        || !['#microsoft.graph.mobileAppDependency', '#microsoft.graph.mobileAppSupersedence'].includes(String(x['@odata.type'])))) throw new RelationshipUpdateError('rejected');
      rows.push(...body.value); url = body['@odata.nextLink'];
    }
    if (url) throw new RelationshipUpdateError('rejected');
    return rows;
  };
  const payload = computeRelationshipUpdate(await list(), baseline, canonical);
  let response: Response;
  try { response = await request(`${BASE}${appId}/updateRelationships`, { method: 'POST', body: JSON.stringify({ relationships: payload }) }); }
  catch (error) { if (error instanceof RelationshipUpdateError) throw error; throw new RelationshipUpdateError('readback_mismatch', true); }
  if (response.status === 409) throw new RelationshipUpdateError('conflict');
  if (response.status !== 204) throw new RelationshipUpdateError('rejected');
  try {
    const actual = (await list()).filter(x => x.targetType === 'child').map(signature).sort();
    if (JSON.stringify(actual) !== JSON.stringify(payload.map(signature).sort())) throw new Error('Mismatch');
  } catch { throw new RelationshipUpdateError('readback_mismatch', true); }
  return canonical;
}
