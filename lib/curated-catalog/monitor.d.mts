import type { CuratedAppDefinition, CuratedCatalogEnvelope } from './types';
export function curatedMonitor(apps: CuratedAppDefinition[], payload: CuratedCatalogEnvelope['payload'], discovery: unknown, now?: Date): { alerts: string[]; pending: string[]; approved: number };
