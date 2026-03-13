/**
 * App Matcher
 * Matches discovered apps from Intune to WinGet packages
 */

import { APP_MAPPINGS, getWingetIdFromName } from '@/lib/app-mappings';
import type { GraphUnmanagedApp, PartialMatch, MatchStatus } from '@/types/unmanaged';

// Alias for backwards compatibility with internal code
type GraphDiscoveredApp = GraphUnmanagedApp;

/**
 * Match result with confidence score
 */
export interface MatchResult {
  status: MatchStatus;
  wingetId: string | null;
  wingetName: string | null;
  confidence: number;
  partialMatches: PartialMatch[];
}

/**
 * Normalize app name for matching
 * Removes version numbers, common suffixes, and normalizes whitespace
 */
export function normalizeAppName(name: string): string {
  return name
    .toLowerCase()
    // Remove version patterns like (x64), x86, v1.2.3, 64-bit, etc.
    .replace(/\s*\(x64\)|\s*\(x86\)|\s*\(64-bit\)|\s*\(32-bit\)/gi, '')
    .replace(/\s*x64|\s*x86|\s*64-bit|\s*32-bit/gi, '')
    .replace(/\s+v?\d+(\.\d+)*(\.\d+)?/g, '')
    // Remove common suffixes
    .replace(/\s+(desktop|client|app|application|setup|installer|portable)$/gi, '')
    // Remove trademark symbols
    .replace(/[^\w\s-]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize publisher name for comparison
 */
export function normalizePublisher(publisher: string | null): string {
  if (!publisher) return '';
  return publisher
    .toLowerCase()
    .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?|corporation|gmbh|ag|sa|bv|plc)$/gi, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate string similarity using Levenshtein distance
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Check for containment
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = Math.max(s1.length, s2.length);
    const shorter = Math.min(s1.length, s2.length);
    return shorter / longer;
  }

  // Levenshtein distance
  const matrix: number[][] = [];

  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - distance / maxLen;
}

/**
 * Match a discovered app against known mappings
 */
export function matchDiscoveredApp(app: GraphDiscoveredApp): MatchResult {
  const normalizedName = normalizeAppName(app.displayName);
  const normalizedPublisher = normalizePublisher(app.publisher);

  // Strategy 1: Exact match using known mappings
  const directMatch = getWingetIdFromName(app.displayName);
  if (directMatch) {
    const mapping = APP_MAPPINGS.find(m => m.wingetId === directMatch);
    return {
      status: 'matched',
      wingetId: directMatch,
      wingetName: mapping?.aliases[0] || directMatch.split('.').pop() || directMatch,
      confidence: 1.0,
      partialMatches: [],
    };
  }

  // Strategy 2: Score all mappings and find best matches
  const scoredMatches: Array<{
    mapping: typeof APP_MAPPINGS[0];
    score: number;
  }> = [];

  for (const mapping of APP_MAPPINGS) {
    let score = 0;

    // Check aliases
    for (const alias of mapping.aliases) {
      const normalizedAlias = normalizeAppName(alias);
      const similarity = calculateSimilarity(normalizedName, normalizedAlias);
      score = Math.max(score, similarity);

      // Bonus for exact normalized match
      if (normalizedName === normalizedAlias) {
        score = 1.0;
        break;
      }
    }

    // Check WinGet ID parts - skip publisher name (first part) to avoid false matches
    // e.g., "Microsoft.Edge" should match on "edge", not "microsoft"
    // Scale score by proportion of app name words that match to prevent false positives
    // e.g., "Intune Log Reader" matching only "reader" from Adobe.Acrobat.Reader = 1/2 = 0.35
    const idParts = mapping.wingetId.toLowerCase().split('.');
    const nameWords = normalizedName.split(/\s+/).filter(w => w.length > 3);
    let matchedNameWordCount = 0;

    for (const word of nameWords) {
      for (let i = 1; i < idParts.length; i++) {
        if (idParts[i].length > 3 && (idParts[i].includes(word) || word.includes(idParts[i]))) {
          matchedNameWordCount++;
          break;
        }
      }
    }

    if (matchedNameWordCount > 0 && nameWords.length > 0) {
      const coverage = matchedNameWordCount / nameWords.length;
      score = Math.max(score, 0.7 * coverage);
    }

    // Publisher bonus
    if (normalizedPublisher && mapping.publisher) {
      const normalizedMappingPublisher = normalizePublisher(mapping.publisher);
      if (normalizedPublisher === normalizedMappingPublisher) {
        score += 0.2;
      } else if (normalizedPublisher.includes(normalizedMappingPublisher) ||
                 normalizedMappingPublisher.includes(normalizedPublisher)) {
        score += 0.1;
      }
    }

    // Cap score at 1.0
    score = Math.min(score, 1.0);

    if (score >= 0.5) {
      scoredMatches.push({ mapping, score });
    }
  }

  // Sort by score descending
  scoredMatches.sort((a, b) => b.score - a.score);

  // High confidence match (>= 0.85)
  if (scoredMatches.length > 0 && scoredMatches[0].score >= 0.85) {
    const best = scoredMatches[0];
    return {
      status: 'matched',
      wingetId: best.mapping.wingetId,
      wingetName: best.mapping.aliases[0],
      confidence: best.score,
      partialMatches: scoredMatches.slice(1, 4).map(m => ({
        wingetId: m.mapping.wingetId,
        name: m.mapping.aliases[0],
        publisher: m.mapping.publisher || '',
        version: null,
        confidence: m.score,
      })),
    };
  }

  // Partial matches (0.5 - 0.85)
  if (scoredMatches.length > 0) {
    return {
      status: 'partial',
      wingetId: scoredMatches[0].mapping.wingetId,
      wingetName: scoredMatches[0].mapping.aliases[0],
      confidence: scoredMatches[0].score,
      partialMatches: scoredMatches.slice(0, 5).map(m => ({
        wingetId: m.mapping.wingetId,
        name: m.mapping.aliases[0],
        publisher: m.mapping.publisher || '',
        version: null,
        confidence: m.score,
      })),
    };
  }

  // No match found
  return {
    status: 'unmatched',
    wingetId: null,
    wingetName: null,
    confidence: 0,
    partialMatches: [],
  };
}

/**
 * Match multiple discovered apps
 */
export function matchDiscoveredApps(apps: GraphDiscoveredApp[]): Map<string, MatchResult> {
  const results = new Map<string, MatchResult>();

  for (const app of apps) {
    results.set(app.id, matchDiscoveredApp(app));
  }

  return results;
}

/**
 * Check if an app is likely a system/framework app that shouldn't be claimed
 */
export function isSystemApp(app: GraphDiscoveredApp): boolean {
  const systemPatterns = [
    /microsoft visual c\+\+/i,
    /\.net framework/i,
    /\.net runtime/i,
    /\.net desktop runtime/i,
    /microsoft\.net/i,
    /windows sdk/i,
    /windows kit/i,
    /microsoft update/i,
    /security update/i,
    /hotfix/i,
    /cumulative update/i,
    /service pack/i,
    /redistributable/i,
    /runtime.*library/i,
    /microsoft asp\.net/i,
    /microsoft edge webview/i,
    /microsoft intune/i,
    /management extension/i,
    /intune management/i,
  ];

  return systemPatterns.some(pattern => pattern.test(app.displayName));
}

/**
 * Filter out system apps from discovered apps list
 */
export function filterUserApps(apps: GraphDiscoveredApp[]): GraphDiscoveredApp[] {
  return apps.filter(app => !isSystemApp(app));
}

/**
 * Sort discovered apps by claimability
 * Higher device count + matched status = higher priority
 */
export function sortByClaimPriority(
  apps: Array<GraphDiscoveredApp & { matchResult: MatchResult }>
): Array<GraphDiscoveredApp & { matchResult: MatchResult }> {
  return [...apps].sort((a, b) => {
    // Matched apps first
    const statusOrder = { matched: 0, partial: 1, unmatched: 2, pending: 3 };
    const statusDiff = statusOrder[a.matchResult.status] - statusOrder[b.matchResult.status];
    if (statusDiff !== 0) return statusDiff;

    // Then by device count (more devices = higher priority)
    return b.deviceCount - a.deviceCount;
  });
}
