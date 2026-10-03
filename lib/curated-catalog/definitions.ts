import definitions from './definitions.json';
import type { CuratedAppDefinition } from './types';

// This module is safe to import from the client. Validation and signing use
// core.mjs on the server/operator side; no Node crypto enters a client bundle.
export const CURATED_APPS = definitions as CuratedAppDefinition[];

export function findCuratedApp(packageId: string): CuratedAppDefinition | undefined {
  return CURATED_APPS.find(app => app.packageId.toLowerCase() === packageId.toLowerCase());
}
