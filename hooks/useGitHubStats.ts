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

const GITHUB_REPO = 'ugurkocde/IntuneGet';
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

export function useGitHubStats(initial?: Partial<GitHubStatValues>): GitHubStats {
  // Initial state must be deterministic: the server cannot read localStorage,
  // so seeding from cache here would make hydration text mismatch for
  // returning visitors. The effect below applies the cache after mount.
  // Server-rendered pages can pass `initial` (fetched server-side); in that
  // case the values are used as-is and the client fetch is skipped entirely.
  const [stats, setStats] = useState<typeof DEFAULT_STATS>({
    ...DEFAULT_STATS,
    ...initial,
  });
  const [isLoading, setIsLoading] = useState(initial === undefined);
  const [error, setError] = useState<Error | null>(null);
  const hasInitialRef = useRef(initial !== undefined);

  useEffect(() => {
    // Server-seeded values are authoritative: skip cache and client fetch
    if (hasInitialRef.current) {
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
        // Fetch repo data for stars and forks
        const repoResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        });

        if (!repoResponse.ok) {
          throw new Error('Failed to fetch GitHub repo stats');
        }

        const repoData = await repoResponse.json();

        // Fetch contributors count
        const contributorsResponse = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/contributors?per_page=1&anon=true`,
          {
            headers: {
              Accept: 'application/vnd.github.v3+json',
            },
          }
        );

        let contributorsCount = DEFAULT_STATS.contributors;
        if (contributorsResponse.ok) {
          // Get total from Link header
          const linkHeader = contributorsResponse.headers.get('Link');
          if (linkHeader) {
            const match = linkHeader.match(/page=(\d+)>; rel="last"/);
            if (match) {
              contributorsCount = parseInt(match[1], 10);
            }
          } else {
            // If no pagination, count from response
            const contributorsData = await contributorsResponse.json();
            contributorsCount = Array.isArray(contributorsData) ? contributorsData.length : DEFAULT_STATS.contributors;
          }
        }

        const newStats = {
          stars: repoData.stargazers_count || DEFAULT_STATS.stars,
          forks: repoData.forks_count || DEFAULT_STATS.forks,
          contributors: contributorsCount,
        };

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
  }, []);

  return {
    ...stats,
    isLoading,
    error,
  };
}
