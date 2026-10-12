import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURATED_APPS } from './definitions';
import { validateDefinitions } from './core.mjs';
import { assertCuratedLicenceAccepted, CuratedLicenceError, getCuratedLicenceRequirement } from './licence';
import type { DatabaseAdapter } from '@/lib/db/types';

const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
const chrome = CURATED_APPS.find(app => app.id === 'chrome')!;
const attestation = acrobat.licenceAttestation!;

let tempDir: string;
beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-licence-'));
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
});
afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
});
async function adapter(): Promise<DatabaseAdapter> {
  return (await import('@/lib/db/sqlite')).sqliteDb;
}
const accept = (db: DatabaseAdapter, tenantId: string, version = attestation.version) => db.curatedLicenceAttestations.accept({
  tenant_id: tenantId, app_id: acrobat.id, attestation_id: attestation.id, attestation_version: version,
  accepted_by_user_id: 'admin-1', accepted_by_email: 'admin@contoso.test',
});

describe('curated licence attestation definitions', () => {
  it('requires the Adobe distribution agreement for Acrobat Reader only', () => {
    expect(attestation).toEqual({ id: 'adobe-acrobat-reader-distribution', title: 'Adobe Acrobat Reader Distribution License Agreement',
      url: 'https://get.adobe.com/reader/licenseform', version: '2026-10-04' });
    expect(CURATED_APPS.filter(app => app.licenceAttestation).map(app => app.id)).toEqual(['acrobat-reader']);
    expect(getCuratedLicenceRequirement(chrome.packageId)).toBeNull();
    expect(getCuratedLicenceRequirement('Adobe.Acrobat.Reader.64-bit')).toBeNull();
    expect(getCuratedLicenceRequirement(acrobat.packageId.toLowerCase())?.attestation).toEqual(attestation);
  });
  it.each([
    ['an insecure URL', { url: 'http://get.adobe.com/reader/licenseform' }],
    ['a missing version', { version: '' }],
    ['an invalid identifier', { id: 'Adobe Reader' }],
    ['unknown fields', { accepted: true }],
  ])('rejects %s', (_label, change) => {
    const apps = structuredClone(CURATED_APPS);
    const app = apps.find(entry => entry.id === 'acrobat-reader')!;
    app.licenceAttestation = { ...app.licenceAttestation!, ...change } as typeof attestation;
    expect(() => validateDefinitions(apps)).toThrow(/licence attestation/i);
  });
  it('requires apps sharing an agreement to declare the same version', () => {
    const apps = structuredClone(CURATED_APPS);
    apps.find(entry => entry.id === 'chrome')!.licenceAttestation = { ...attestation, version: 'other' };
    expect(() => validateDefinitions(apps)).toThrow(/same agreement/);
  });
});

describe('assertCuratedLicenceAccepted', () => {
  it('leaves applications without a requirement untouched and never reads the database', async () => {
    const db = { curatedLicenceAttestations: { get: vi.fn() } } as unknown as DatabaseAdapter;
    await expect(assertCuratedLicenceAccepted('tenant-a', chrome.packageId, db)).resolves.toBeNull();
    await expect(assertCuratedLicenceAccepted('tenant-a', 'Google.Chrome', db)).resolves.toBeNull();
    expect(db.curatedLicenceAttestations.get).not.toHaveBeenCalled();
  });
  it('blocks a tenant that has not accepted the agreement', async () => {
    const db = await adapter();
    await expect(assertCuratedLicenceAccepted('tenant-a', acrobat.packageId, db)).rejects.toBeInstanceOf(CuratedLicenceError);
    await expect(assertCuratedLicenceAccepted(null, acrobat.packageId, db)).rejects.toMatchObject({ code: 'CURATED_LICENCE_NOT_ACCEPTED' });
  });
  it('allows the accepting tenant and returns the audit snapshot', async () => {
    const db = await adapter();
    await accept(db, 'tenant-a');
    await expect(assertCuratedLicenceAccepted('tenant-a', acrobat.packageId, db)).resolves.toMatchObject({
      attestationId: attestation.id, attestationVersion: attestation.version,
      acceptedByUserId: 'admin-1', acceptedByEmail: 'admin@contoso.test',
    });
  });
  it('does not let one tenant\'s acceptance authorize another tenant', async () => {
    const db = await adapter();
    await accept(db, 'tenant-a');
    await expect(assertCuratedLicenceAccepted('tenant-b', acrobat.packageId, db)).rejects.toBeInstanceOf(CuratedLicenceError);
  });
  it('requires acceptance again after the agreement version changes', async () => {
    const db = await adapter();
    await accept(db, 'tenant-a', '2025-01-01');
    await expect(assertCuratedLicenceAccepted('tenant-a', acrobat.packageId, db)).rejects.toBeInstanceOf(CuratedLicenceError);
    await accept(db, 'tenant-a');
    await expect(assertCuratedLicenceAccepted('tenant-a', acrobat.packageId, db)).resolves.not.toBeNull();
  });
  it('keeps the first acceptance of a version as the audit record', async () => {
    const db = await adapter();
    const first = await accept(db, 'tenant-a');
    const second = await db.curatedLicenceAttestations.accept({ ...first, accepted_by_user_id: 'someone-else' });
    expect(second).toEqual(first);
    expect(await db.curatedLicenceAttestations.listByTenant('tenant-a')).toHaveLength(1);
  });
});
