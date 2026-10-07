import { getDatabase } from '@/lib/db';
import type { DatabaseAdapter } from '@/lib/db/types';
import { acquireGraphToken } from '@/lib/graph-token';
import { isIntuneApprovalFailure, INTUNE_APPROVAL_PENDING_MESSAGE } from '@/lib/intune-approval';

type RetainedAppState = 'present' | 'absent' | 'unknown';
type Dependencies = {
  db?: DatabaseAdapter;
  checkRetainedApp?: (tenantId: string, appId: string) => Promise<RetainedAppState>;
};
export interface IntuneApprovalBlock {
  wingetId: string;
  code: 'INTUNE_APPROVAL_PENDING';
  message: string;
  reason: 'retained_app_present' | 'retained_app_unverified' | 'release_check_failed';
}
const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** Never create another app while a prior protected upload remains unresolved. */
export async function findPendingApprovalBlocks(
  input: { tenantId: string; wingetIds: string[] },
  deps: Dependencies = {}
): Promise<IntuneApprovalBlock[]> {
  const db = deps.db || getDatabase();
  let accessToken: string | undefined;
  const checkRetainedApp = deps.checkRetainedApp || (async (tenantId, appId) => {
    accessToken ||= (await acquireGraphToken(tenantId)).accessToken;
    const response = await fetch(
      `https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/${appId}?$select=id`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (response.status === 404) return 'absent';
    if (response.status !== 200) return 'unknown';
    const body = await response.json();
    return typeof body?.id === 'string' && body.id.toLowerCase() === appId.toLowerCase()
      ? 'present' : 'unknown';
  });
  const blocks: IntuneApprovalBlock[] = [];
  // Cache only within this request, including IDs repeated across version checkpoints.
  const checked = new Map<string, RetainedAppState>();
  for (const wingetId of new Set(input.wingetIds)) {
    let reason: IntuneApprovalBlock['reason'] | undefined;
    try {
      let cursor: { createdAt: string; id: string } | undefined;
      for (let page = 0; page < 10; page++) {
        const jobs = await db.jobs.getApprovalFailures(input.tenantId, wingetId, cursor);
        for (const job of jobs) {
          if (job.tenant_id !== input.tenantId || job.winget_id !== wingetId ||
              job.status !== 'failed' || !isIntuneApprovalFailure(job)) {
            reason = 'release_check_failed'; break;
          }
          const details = job.error_details;
          const appId = details && typeof details === 'object' && !Array.isArray(details)
            ? details.intuneAppId : undefined;
          if (typeof appId !== 'string' || !GUID.test(appId)) {
            reason = 'retained_app_unverified'; break;
          }
          const key = appId.toLowerCase();
          if (!checked.has(key)) {
            if (checked.size >= 20) { reason = 'release_check_failed'; break; }
            checked.set(key, await checkRetainedApp(input.tenantId, appId));
          }
          const state = checked.get(key);
          if (state !== 'absent') {
            reason = state === 'present' ? 'retained_app_present' : 'release_check_failed'; break;
          }
        }
        if (reason || jobs.length < 100) break;
        if (page === 9) { reason = 'release_check_failed'; break; }
        const last = jobs.at(-1)!;
        const next = { createdAt: last.created_at, id: last.id };
        if (cursor && cursor.createdAt === next.createdAt && cursor.id === next.id) {
          reason = 'release_check_failed'; break;
        }
        cursor = next;
      }
    } catch {
      // Do not expose Graph responses, credentials, or another user's job metadata.
      reason = 'release_check_failed';
    }
    if (reason) blocks.push({ wingetId, code: 'INTUNE_APPROVAL_PENDING', reason,
      message: reason === 'retained_app_unverified'
        ? `${INTUNE_APPROVAL_PENDING_MESSAGE} The earlier app identity was not recorded; contact support to reconcile it.`
        : reason === 'release_check_failed'
          ? 'IntuneGet could not confirm that an earlier approval failure is resolved. No new deployment was started. Try again when the approval check is available.'
          : INTUNE_APPROVAL_PENDING_MESSAGE });
  }
  return blocks;
}
