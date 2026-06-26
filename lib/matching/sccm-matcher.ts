/**
 * SCCM App Matcher
 * Extends the base app-matcher with SCCM-specific matching logic
 * including custom SCCM mappings and MSI product code matching
 */

import {
  normalizeAppName,
  normalizePublisher,
  calculateSimilarity,
  type MatchResult,
} from './app-matcher';
import { APP_MAPPINGS, getWingetIdFromName, searchCuratedApps } from '@/lib/app-mappings';
import { getCatalogSource } from '@/lib/catalog';
import type {
  SccmApplication,
  SccmMsiDetectionClause,
  SccmDeploymentTechnology,
} from '@/types/sccm';
import type { PartialMatch, MatchStatus } from '@/types/unmanaged';

/**
 * Extended match result with SCCM-specific information
 */
export interface SccmMatchResult extends MatchResult {
  matchedBy: 'auto' | 'mapping' | 'product_code' | 'curated' | null;
  mappingId?: string;
}

/**
 * SCCM app technology types that are not supported for migration
 */
const UNSUPPORTED_TECHNOLOGIES: SccmDeploymentTechnology[] = ['AppV', 'MacOS'];

/**
 * Common enterprise software name variations to normalize
 */
const ENTERPRISE_NAME_NORMALIZATIONS: Record<string, string[]> = {
  'Microsoft 365': [
    'Microsoft 365 Apps for enterprise',
    'Microsoft 365 Apps for business',
    'Office 365 ProPlus',
    'Office 365 Business',
    'Microsoft Office 365',
  ],
  'Adobe Creative Cloud': [
    'Adobe Creative Cloud All Apps',
    'Adobe CC',
    'Creative Cloud Desktop',
  ],
  'Cisco AnyConnect': [
    'Cisco AnyConnect Secure Mobility Client',
    'Cisco Secure Client',
    'AnyConnect VPN',
  ],
};

/**
 * Normalize SCCM-specific app names
 * Handles enterprise naming conventions
 */
export function normalizeSccmAppName(name: string): string {
  let normalized = name;

  // Apply enterprise name normalizations
  for (const [canonical, variations] of Object.entries(ENTERPRISE_NAME_NORMALIZATIONS)) {
    for (const variation of variations) {
      if (normalized.toLowerCase().includes(variation.toLowerCase())) {
        normalized = canonical;
        break;
      }
    }
  }

  // Apply standard normalization
  return normalizeAppName(normalized);
}

/**
 * Extract MSI product code from SCCM detection clauses
 */
export function extractProductCode(app: SccmApplication): string | null {
  // deploymentTypes / detectionClauses can arrive as a non-array from quirky
  // JSON exports; guard so matching never throws on a bad shape.
  for (const dt of Array.isArray(app.deploymentTypes) ? app.deploymentTypes : []) {
    for (const clause of Array.isArray(dt?.detectionClauses) ? dt.detectionClauses : []) {
      if (clause.type === 'MSI') {
        const msiClause = clause as SccmMsiDetectionClause;
        if (msiClause.productCode) {
          return msiClause.productCode;
        }
      }
    }
  }
  return null;
}

/**
 * Check if an SCCM app technology is supported for migration
 */
export function isSupportedTechnology(technology: SccmDeploymentTechnology): boolean {
  return !UNSUPPORTED_TECHNOLOGIES.includes(technology);
}

/**
 * Get the primary deployment type for an SCCM app
 */
export function getPrimaryDeploymentType(app: SccmApplication) {
  // deploymentTypes can arrive as a non-array (single object) or null from
  // quirky JSON exports; guard against a non-iterable before spreading.
  const deploymentTypes = Array.isArray(app.deploymentTypes) ? app.deploymentTypes : [];
  // Sort by priority (lower is better) and return first
  const sorted = [...deploymentTypes].sort((a, b) =>
    (a.priority ?? 999) - (b.priority ?? 999)
  );
  return sorted[0] || null;
}

/**
 * Check SCCM-specific custom mappings
 */
export async function checkSccmMapping(
  app: SccmApplication,
  tenantId: string,
  // Kept for call-site compatibility; the catalog source owns client creation.
  _supabaseClient?: { from: (table: string) => unknown }
): Promise<SccmMatchResult | null> {
  const normalizedName = app.localizedDisplayName.toLowerCase().trim();
  const productCode = extractProductCode(app);

  return getCatalogSource().getSccmMapping(
    {
      displayNameNormalized: normalizedName,
      ciId: String(app.ci_id ?? ''),
      productCode,
    },
    tenantId
  );
}

/**
 * Match an SCCM app against known mappings and curated catalog
 */
export async function matchSccmApp(
  app: SccmApplication,
  tenantId: string | null,
  supabaseClient: { from: (table: string) => unknown }
): Promise<SccmMatchResult> {
  // Check if technology is supported
  const primaryDT = getPrimaryDeploymentType(app);
  if (primaryDT && !isSupportedTechnology(primaryDT.technology)) {
    return {
      status: 'unmatched',
      wingetId: null,
      wingetName: null,
      confidence: 0,
      partialMatches: [],
      matchedBy: null,
    };
  }

  // Strategy 1: Check custom SCCM mappings first (highest priority)
  if (tenantId) {
    const mappingResult = await checkSccmMapping(app, tenantId, supabaseClient);
    if (mappingResult) {
      return mappingResult;
    }
  }

  const normalizedName = normalizeSccmAppName(app.localizedDisplayName);
  const normalizedPublisher = normalizePublisher(app.manufacturer);

  // Strategy 2: Exact match using known APP_MAPPINGS
  const directMatch = getWingetIdFromName(app.localizedDisplayName);
  if (directMatch) {
    const mapping = APP_MAPPINGS.find(m => m.wingetId === directMatch);
    return {
      status: 'matched',
      wingetId: directMatch,
      wingetName: mapping?.aliases[0] || directMatch.split('.').pop() || directMatch,
      confidence: 1.0,
      partialMatches: [],
      matchedBy: 'auto',
    };
  }

  // Strategy 3: Search curated apps database
  try {
    const curatedResults = await searchCuratedApps(app.localizedDisplayName, supabaseClient);
    if (curatedResults.length > 0) {
      // Score curated results
      const scoredCurated = curatedResults.map(curated => {
        let score = 0;
        const curatedNormalized = normalizeAppName(curated.name);
        const curatedPublisherNorm = normalizePublisher(curated.publisher);

        // Name similarity
        const nameSimilarity = calculateSimilarity(normalizedName, curatedNormalized);
        score = nameSimilarity;

        // Publisher bonus
        if (normalizedPublisher && curatedPublisherNorm) {
          if (normalizedPublisher === curatedPublisherNorm) {
            score += 0.2;
          } else if (
            normalizedPublisher.includes(curatedPublisherNorm) ||
            curatedPublisherNorm.includes(normalizedPublisher)
          ) {
            score += 0.1;
          }
        }

        return { curated, score: Math.min(score, 1.0) };
      });

      scoredCurated.sort((a, b) => b.score - a.score);

      // High confidence match from curated
      if (scoredCurated[0].score >= 0.85) {
        const best = scoredCurated[0];
        return {
          status: 'matched',
          wingetId: best.curated.wingetId,
          wingetName: best.curated.name,
          confidence: best.score,
          partialMatches: scoredCurated.slice(1, 5).map(m => ({
            wingetId: m.curated.wingetId,
            name: m.curated.name,
            publisher: m.curated.publisher,
            version: m.curated.latestVersion,
            confidence: m.score,
          })),
          matchedBy: 'curated',
        };
      }

      // Partial matches from curated
      if (scoredCurated[0].score >= 0.5) {
        return {
          status: 'partial',
          wingetId: scoredCurated[0].curated.wingetId,
          wingetName: scoredCurated[0].curated.name,
          confidence: scoredCurated[0].score,
          partialMatches: scoredCurated.slice(0, 5).map(m => ({
            wingetId: m.curated.wingetId,
            name: m.curated.name,
            publisher: m.curated.publisher,
            version: m.curated.latestVersion,
            confidence: m.score,
          })),
          matchedBy: 'curated',
        };
      }
    }
  } catch (e) {
    console.error('Error searching curated apps for SCCM match:', e);
  }

  // Strategy 4: Score all APP_MAPPINGS
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

      if (normalizedName === normalizedAlias) {
        score = 1.0;
        break;
      }
    }

    // Check WinGet ID parts (skip publisher)
    const idParts = mapping.wingetId.toLowerCase().split('.');
    for (let i = 1; i < idParts.length; i++) {
      const part = idParts[i];
      if (normalizedName.includes(part) && part.length > 3) {
        score = Math.max(score, 0.7);
      }
    }

    // Publisher bonus
    if (normalizedPublisher && mapping.publisher) {
      const normalizedMappingPublisher = normalizePublisher(mapping.publisher);
      if (normalizedPublisher === normalizedMappingPublisher) {
        score += 0.2;
      } else if (
        normalizedPublisher.includes(normalizedMappingPublisher) ||
        normalizedMappingPublisher.includes(normalizedPublisher)
      ) {
        score += 0.1;
      }
    }

    score = Math.min(score, 1.0);

    if (score >= 0.5) {
      scoredMatches.push({ mapping, score });
    }
  }

  scoredMatches.sort((a, b) => b.score - a.score);

  // High confidence match
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
      matchedBy: 'auto',
    };
  }

  // Partial matches
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
      matchedBy: 'auto',
    };
  }

  // No match
  return {
    status: 'unmatched',
    wingetId: null,
    wingetName: null,
    confidence: 0,
    partialMatches: [],
    matchedBy: null,
  };
}

/**
 * Match multiple SCCM apps with batch processing
 */
export async function matchSccmApps(
  apps: SccmApplication[],
  tenantId: string | null,
  supabaseClient: { from: (table: string) => unknown },
  onProgress?: (processed: number, total: number, currentApp: string) => void
): Promise<Map<string, SccmMatchResult>> {
  const results = new Map<string, SccmMatchResult>();

  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];

    if (onProgress) {
      onProgress(i, apps.length, app.localizedDisplayName);
    }

    const result = await matchSccmApp(app, tenantId, supabaseClient);
    results.set(app.ci_id, result);
  }

  if (onProgress) {
    onProgress(apps.length, apps.length, 'Complete');
  }

  return results;
}

/**
 * Check if SCCM app should be skipped (framework, runtime, etc.)
 */
export function isSccmSystemApp(app: SccmApplication): boolean {
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
    /sccm client/i,
    /configuration manager client/i,
    /microsoft endpoint/i,
  ];

  return systemPatterns.some(pattern => pattern.test(app.localizedDisplayName));
}

/**
 * Filter out system apps from SCCM apps list
 */
export function filterUserSccmApps(apps: SccmApplication[]): SccmApplication[] {
  return apps.filter(app => !isSccmSystemApp(app));
}

/**
 * Sort SCCM apps by migration priority
 * Deployed apps + matched + high deployment count = higher priority
 */
export function sortByMigrationPriority(
  apps: Array<SccmApplication & { matchResult: SccmMatchResult }>
): Array<SccmApplication & { matchResult: SccmMatchResult }> {
  return [...apps].sort((a, b) => {
    // Deployed apps first
    if (a.isDeployed !== b.isDeployed) {
      return a.isDeployed ? -1 : 1;
    }

    // Matched apps first
    const statusOrder: Record<MatchStatus, number> = {
      matched: 0,
      partial: 1,
      unmatched: 2,
      pending: 3,
    };
    const statusDiff = statusOrder[a.matchResult.status] - statusOrder[b.matchResult.status];
    if (statusDiff !== 0) return statusDiff;

    // Then by deployment count
    return (b.deploymentCount ?? 0) - (a.deploymentCount ?? 0);
  });
}

/**
 * Calculate match statistics for a set of SCCM apps
 */
export function calculateMatchStats(
  apps: Array<{ matchResult: SccmMatchResult }>
): {
  total: number;
  matched: number;
  partial: number;
  unmatched: number;
  matchRate: number;
} {
  const total = apps.length;
  const matched = apps.filter(a => a.matchResult.status === 'matched').length;
  const partial = apps.filter(a => a.matchResult.status === 'partial').length;
  const unmatched = apps.filter(a => a.matchResult.status === 'unmatched').length;

  return {
    total,
    matched,
    partial,
    unmatched,
    matchRate: total > 0 ? (matched + partial) / total : 0,
  };
}
