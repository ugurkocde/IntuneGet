import type { CuratedAppDefinition, CuratedCandidate } from './types';
export function candidateFromMetadata(app: CuratedAppDefinition, text: string, now?: Date): CuratedCandidate;
export function discoverCandidate(app: CuratedAppDefinition, fetcher?: typeof fetch, now?: Date): Promise<
  { appId: string; state: 'manual'; releaseSource: string } | { appId: string; state: 'candidate'; candidate: CuratedCandidate }
>;
