import { getDatabase } from '@/lib/db';
import type { CuratedLicenceAttestationRecord, DatabaseAdapter } from '@/lib/db/types';
import { isCuratedPackageId } from './core.mjs';
import { findCuratedApp } from './definitions';
import type { CuratedAppDefinition, CuratedLicenceAcceptanceSnapshot, CuratedLicenceAttestation } from './types';

export type { CuratedLicenceAcceptanceSnapshot };

export const CURATED_LICENCE_NOT_ACCEPTED = 'CURATED_LICENCE_NOT_ACCEPTED';

export class CuratedLicenceError extends Error {
  readonly code = CURATED_LICENCE_NOT_ACCEPTED;
  constructor(readonly app: CuratedAppDefinition, readonly attestation: CuratedLicenceAttestation) {
    super(`${app.name} requires your organization to accept the ${attestation.title} before it can be deployed to this tenant. Accept it in the IntuneGet Curated Catalog, then try again.`);
    this.name = 'CuratedLicenceError';
  }
}

export function getCuratedLicenceRequirement(packageId: string | null | undefined) {
  if (!isCuratedPackageId(packageId)) return null;
  const app = findCuratedApp(packageId as string);
  return app?.licenceAttestation ? { app, attestation: app.licenceAttestation } : null;
}

export function toLicenceAcceptanceSnapshot(record: CuratedLicenceAttestationRecord): CuratedLicenceAcceptanceSnapshot {
  return {
    attestationId: record.attestation_id, attestationVersion: record.attestation_version,
    acceptedAt: record.accepted_at, acceptedByUserId: record.accepted_by_user_id,
    acceptedByEmail: record.accepted_by_email,
  };
}

/**
 * Authoritative server-side check that the target tenant accepted the exact
 * licence agreement version a curated application requires. Returns null for
 * applications without a requirement (no database access), the acceptance
 * snapshot when accepted, and throws CuratedLicenceError otherwise.
 */
export async function assertCuratedLicenceAccepted(
  tenantId: string | null | undefined,
  packageId: string | null | undefined,
  db?: Pick<DatabaseAdapter, 'curatedLicenceAttestations'>
): Promise<CuratedLicenceAcceptanceSnapshot | null> {
  const requirement = getCuratedLicenceRequirement(packageId);
  if (!requirement) return null;
  const { app, attestation } = requirement;
  if (!tenantId) throw new CuratedLicenceError(app, attestation);
  const record = await (db ?? getDatabase()).curatedLicenceAttestations.get(tenantId, attestation.id, attestation.version);
  if (!record) throw new CuratedLicenceError(app, attestation);
  return toLicenceAcceptanceSnapshot(record);
}
