import type { CuratedAppDefinition, CuratedCandidate } from './types';
export function vendorSha256FromChecksums(app: CuratedAppDefinition, installerUrl: string, version: string, text: string): string;
export function candidateFromMetadata(app: CuratedAppDefinition, text: string, now?: Date, checksumText?: string | null): CuratedCandidate;
export function discoverCandidate(app: CuratedAppDefinition, fetcher?: typeof fetch, now?: Date): Promise<
  { appId: string; state: 'manual'; releaseSource: string } | { appId: string; state: 'candidate'; candidate: CuratedCandidate }
>;
export function discoverPreviousCandidate(app: CuratedAppDefinition, current: CuratedCandidate, fetcher?: typeof fetch, now?: Date): Promise<CuratedCandidate | null>;
