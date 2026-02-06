'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface LandingStats {
  signinClicks: number;
  appsDeployed: number;
  appsSupported: number;
  isLoading: boolean;
  error: Error | null;
}

// Default fallback values (close to actual) to prevent layout shift during load
const DEFAULT_STATS = {
  signinClicks: 1000,
  appsDeployed: 2000,
  appsSupported: 10000,
};

export function useLandingStats(): LandingStats {
  const [stats, setStats] = useState<{ signinClicks: number; appsDeployed: number; appsSupported: number }>(DEFAULT_STATS);
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

  // Subscribe to realtime updates for site_counters
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    let channel: RealtimeChannel | null = null;

    try {
      const supabase = getSupabaseClient();
      channel = supabase
        .channel('site_counters_changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'site_counters',
          },
          (payload) => {
            const { id, value } = payload.new as { id: string; value: number };
            setStats((prev) => {
              if (id === 'apps_deployed') {
                return { ...prev, appsDeployed: value };
              }
              if (id === 'signin_clicks') {
                return { ...prev, signinClicks: value };
              }
              return prev;
            });
          }
        )
        .subscribe();
    } catch (err) {
      console.error('Failed to subscribe to realtime updates:', err);
    }

    return () => {
      if (channel) {
        channel.unsubscribe();
      }
    };
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

export async function trackDeployment(count: number = 1): Promise<void> {
  try {
    // Fire-and-forget
    fetch('/api/stats/track-deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ count }),
    }).catch(() => {
      // Silently ignore errors
    });
  } catch {
    // Silently ignore errors
  }
}
