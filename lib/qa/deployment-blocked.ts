import type { QaStatusRow } from '@/types/qa';

export interface QaBlockedTuple {
  winget_id: string;
  version: string;
  architecture: string;
  installer_sha256: string;
}

/** Deployment availability is tied to the immutable payload, not a result outcome. */
export function markBlockedQaResults<T extends QaStatusRow>(rows: T[], blocks: QaBlockedTuple[]): T[] {
  const key = (id: string, version: string, architecture: string, sha: string) =>
    JSON.stringify([id, version, architecture, sha.toUpperCase()]);
  const blocked = new Set(blocks.map(b => key(b.winget_id, b.version, b.architecture, b.installer_sha256)));
  return rows.map(row => ({ ...row, deployment_blocked: !!row.installer_sha256 &&
    blocked.has(key(row.winget_id, row.tested_version, row.architecture, row.installer_sha256)) }));
}
