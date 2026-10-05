import type { CuratedAppDefinition, CuratedCandidate, CuratedRelease, CuratedCatalogEnvelope, CuratedCatalogEntry } from './types';
export class CuratedCatalogError extends Error { readonly code: 'CURATED_RELEASE_UNAVAILABLE'; constructor(message: string); }
export const MIRROR_REDIRECT_POLICY: 'any-https-mirror-with-pinned-sha256';
export function canonicalJson(value: unknown): string;
export function sha256(value: string): string;
export function isCuratedPackageId(value: unknown): boolean;
export function assertHttpsUrl(value: string): URL;
export function assertInstallerSource(app: CuratedAppDefinition, value: string): URL;
export function validateDefinitions(apps: unknown): CuratedAppDefinition[];
export function checksumSourceUrl(app: CuratedAppDefinition, version: string): string;
export function createCandidate(app: CuratedAppDefinition, input: { version: string; installerUrl: string; vendorSha256?: string | null; releaseNotesUrl?: string }, now?: Date): CuratedCandidate;
export function validateCandidate(app: CuratedAppDefinition, candidate: CuratedCandidate, now?: Date): CuratedCandidate;
export function validateRelease(app: CuratedAppDefinition, release: CuratedRelease, now?: Date): CuratedRelease;
export function compareReleaseVersions(left: string, right: string): number;
export function verifyCatalog(envelope: unknown, apps: CuratedAppDefinition[], trustedKeys: Record<string, string>, now?: Date): CuratedCatalogEnvelope['payload'];
export function signCatalog(payload: CuratedCatalogEnvelope['payload'], apps: CuratedAppDefinition[], keyId: string, privateKey: string): CuratedCatalogEnvelope;
export function catalogEntries(apps: CuratedAppDefinition[], payload: CuratedCatalogEnvelope['payload']): CuratedCatalogEntry[];
export function verifyCatalogSignature(envelope: unknown, trustedKeys: Record<string, string>): CuratedCatalogEnvelope['payload'];
export function verifyCatalogReleases(envelope: unknown, apps: CuratedAppDefinition[], trustedKeys: Record<string, string>, now?: Date): { payload: CuratedCatalogEnvelope['payload']; current: boolean };
