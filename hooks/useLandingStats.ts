'use client';

import { useState, useEffect } from 'react';

interface LandingStats {
  signinClicks: number;
  appsDeployed: number;
  appsSupported: number;
  isLoading: boolean;
  error: Error | null;
}

export function useLandingStats(): LandingStats {
  const [stats, setStats] = useState<{ signinClicks: number; appsDeployed: number; appsSupported: number }>({
    signinClicks: 0,
    appsDeployed: 0,
    appsSupported: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api/stats/public');
        if (!response.ok) {
          throw new Error('Failed to fetch stats');
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
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

export async function trackSigninClick(): Promise<void> {
  try {
    // Fire-and-forget
    fetch('/api/stats/track-signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    }).catch(() => {
      // Silently ignore errors
    });
  } catch {
    // Silently ignore errors
  }
}
