'use client';

import { useState, useEffect, useRef } from 'react';

interface GitHubStats {
  stars: number;
  forks: number;
  contributors: number;
  isLoading: boolean;
  error: Error | null;
}

export interface GitHubStatValues {
  stars: number;
  forks: number;
  contributors: number;
}

// Default fallback values to prevent layout shift
const DEFAULT_STATS = {
  stars: 100,
  forks: 20,
  contributors: 5,
};

const CACHE_KEY = 'github_stats_cache';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CachedData {
  stats: typeof DEFAULT_STATS;
  timestamp: number;
}

function getCachedStats(): typeof DEFAULT_STATS | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const { stats, timestamp }: CachedData = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_DURATION) {
      return stats;
    }
  } catch {
    // Ignore cache errors
  }
  return null;
}

function setCachedStats(stats: typeof DEFAULT_STATS): void {
  if (typeof window === 'undefined') return;

  try {
    const cacheData: CachedData = {
      stats,
      timestamp: Date.now(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  } catch {
    // Ignore cache errors
  }
}

interface UseGitHubStatsOptions {
  /**
   * When false the hook keeps its seed values and performs no fetching.
   * Used by the shared-stats context wrappers so a page-level provider can
   * own the single live instance while consumers stay hook-order safe.
   */
  enabled?: boolean;
}

export function useGitHubStats(
  initial?: Partial<GitHubStatValues>,
  options: UseGitHubStatsOptions = {},
): GitHubStats {
  const { enabled = true } = options;
  // Initial state must be deterministic: the server cannot read localStorage,
  // so seeding from cache here would make hydration text mismatch for
  // returning visitors. The effect below applies the cache after mount.
  // Server-rendered pages can pass `initial` (fetched server-side); in that
  // case the values are used as-is and the client fetch is skipped entirely.
  const [stats, setStats] = useState<typeof DEFAULT_STATS>({
    ...DEFAULT_STATS,
    ...initial,
  });
  const [isLoading, setIsLoading] = useState(initial === undefined && enabled);
  const [error, setError] = useState<Error | null>(null);
  const hasInitialRef = useRef(initial !== undefined);

  useEffect(() => {
    // Server-seeded values are authoritative: skip cache and client fetch
    if (!enabled || hasInitialRef.current) {
      return;
    }

    // Check cache first
    const cached = getCachedStats();
    if (cached) {
      setStats(cached);
      setIsLoading(false);
      return;
    }

    async function fetchStats() {
      try {
        // Same-origin route backed by the server-side fetch cache. Hitting
        // api.github.com from the browser is rate-limited per client IP and
        // fails via CORS in some environments; the server has neither problem.
        const response = await fetch('/api/stats/github');
        if (!response.ok) {
          throw new Error('Failed to fetch GitHub repo stats');
        }

        const newStats = (await response.json()) as GitHubStatValues;
        setStats(newStats);
        setCachedStats(newStats);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
        // Keep using default or cached values on error
      } finally {
        setIsLoading(false);
      }
    }

    fetchStats();
  }, [enabled]);

  return {
    ...stats,
    isLoading,
    error,
  };
}
