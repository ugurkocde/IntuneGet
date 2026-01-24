/**
 * App Matching Algorithm
 * Multi-pass matching between Intune apps and Winget packages
 */

import { getWingetIdFromName, getMappingByWingetId, APP_MAPPINGS } from './app-mappings';
import type { IntuneWin32App } from '@/types/inventory';

export interface MatchResult {
  confidence: 'high' | 'medium' | 'low';
  wingetId: string;
  matchReason: string;
}

/**
 * Normalize a string for comparison
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Extract potential Winget ID from app name
 * Looks for patterns like "Publisher.AppName" in the display name
 */
function extractWingetIdPattern(name: string): string | null {
  // Pattern: Publisher.AppName or Publisher.AppName.Variant
  // Case-insensitive to match IDs like "python.python.3.12" or "dbeaver.dbeaver"
  const idPattern = /([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)*)/;
  const match = name.match(idPattern);
  return match ? match[1] : null;
}

/**
 * Validate if a string looks like a valid Winget ID
 */
export function isValidWingetId(id: string): boolean {
  // Winget IDs follow the pattern: Publisher.PackageName(.Variant)*
  // Must have at least two dot-separated parts
  const pattern = /^[A-Za-z0-9]+\.[A-Za-z0-9]+(\.[A-Za-z0-9-]+)*$/;
  return pattern.test(id);
}

/**
 * Match Intune app to Winget package
 * Uses multi-pass matching algorithm:
 * 1. Known mappings lookup
 * 2. Winget ID pattern extraction
 * 3. Exact name match
 * 4. Publisher + partial name match
 */
export function matchAppToWinget(app: IntuneWin32App): MatchResult | null {
  const displayName = app.displayName;
  const publisher = app.publisher || '';
  const normalizedName = normalizeString(displayName);
  const normalizedPublisher = normalizeString(publisher);

  // Pass 1: Known mappings lookup
  const mappedWingetId = getWingetIdFromName(displayName);
  if (mappedWingetId) {
    return {
      confidence: 'high',
      wingetId: mappedWingetId,
      matchReason: 'Known app mapping',
    };
  }

  // Pass 2: Winget ID pattern in name
  const extractedId = extractWingetIdPattern(displayName);
  if (extractedId) {
    return {
      confidence: 'high',
      wingetId: extractedId,
      matchReason: 'Winget ID pattern found in name',
    };
  }

  // Pass 3: Check if display name contains a known Winget ID
  for (const mapping of APP_MAPPINGS) {
    const normalizedId = normalizeString(mapping.wingetId.split('.').join(''));
    if (normalizedName.includes(normalizedId)) {
      return {
        confidence: 'medium',
        wingetId: mapping.wingetId,
        matchReason: 'Name contains Winget ID',
      };
    }
  }

  // Pass 4: Publisher + name combination
  if (publisher) {
    const combinedName = `${publisher}.${displayName.replace(/\s+/g, '')}`;
    const normalizedCombined = normalizeString(combinedName);

    for (const mapping of APP_MAPPINGS) {
      const normalizedMappingId = normalizeString(mapping.wingetId);
      if (normalizedCombined.includes(normalizedMappingId) ||
          normalizedMappingId.includes(normalizedCombined)) {
        return {
          confidence: 'medium',
          wingetId: mapping.wingetId,
          matchReason: 'Publisher and name combination match',
        };
      }
    }

    // Generate a potential Winget ID from publisher and name
    const potentialId = generatePotentialWingetId(publisher, displayName);
    if (potentialId) {
      return {
        confidence: 'low',
        wingetId: potentialId,
        matchReason: 'Generated from publisher and name',
      };
    }
  }

  return null;
}

/**
 * Generate a potential Winget ID from publisher and app name
 */
function generatePotentialWingetId(publisher: string, name: string): string | null {
  if (!publisher || !name) return null;

  // Clean publisher name
  const cleanPublisher = publisher
    .replace(/\s*(LLC|Inc|Ltd|Corporation|Corp|GmbH|Software|Technologies)\s*/gi, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();

  // Clean app name
  const cleanName = name
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();

  if (!cleanPublisher || !cleanName) return null;

  // Capitalize first letter of each word
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  return `${capitalize(cleanPublisher)}.${capitalize(cleanName)}`;
}

/**
 * Get all apps that could have updates
 */
export function getAppsWithPotentialUpdates(apps: IntuneWin32App[]): {
  app: IntuneWin32App;
  match: MatchResult;
}[] {
  const results: { app: IntuneWin32App; match: MatchResult }[] = [];

  for (const app of apps) {
    const match = matchAppToWinget(app);
    if (match) {
      results.push({ app, match });
    }
  }

  // Sort by confidence (high first)
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => confidenceOrder[a.match.confidence] - confidenceOrder[b.match.confidence]);

  return results;
}

/**
 * Score how well two version strings might match
 */
export function versionSimilarity(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number).filter(n => !isNaN(n));
  const parts2 = v2.split('.').map(Number).filter(n => !isNaN(n));

  let matches = 0;
  const minLength = Math.min(parts1.length, parts2.length);

  for (let i = 0; i < minLength; i++) {
    if (parts1[i] === parts2[i]) {
      matches++;
    } else {
      break;
    }
  }

  return matches / Math.max(parts1.length, parts2.length);
}
