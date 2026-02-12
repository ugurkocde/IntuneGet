'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface LandingStats {
  signinClicks: number;
  appsDeployed: number;
  appsSupported: number;
  isLoading: boolean;
  error: Error | null;
}

interface LandingStatValues {
  signinClicks: number;
  appsDeployed: number;
  appsSupported: number;
}

interface FetchStatsOptions {
  silent?: boolean;
}

// Default fallback values (close to actual) to prevent layout shift during load
const DEFAULT_STATS: LandingStatValues = {
  signinClicks: 1000,
  appsDeployed: 2000,
  appsSupported: 10000,
};

const POLL_INTERVAL_HEALTHY_MS = 20000;
const POLL_INTERVAL_DEGRADED_MS = 8000;
const POLL_INTERVAL_HIDDEN_MS = 60000;
const POLL_MAX_BACKOFF_MS = 60000;
const MAX_FAILURE_BACKOFF_STEPS = 3;

export function useLandingStats(): LandingStats {
  const [stats, setStats] = useState<LandingStatValues>(DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const realtimeConnectedRef = useRef(false);
  const pollingFailureCountRef = useRef(0);

  const applyCounterUpdate = useCallback((counterId: string, value: unknown) => {
    const parsedValue = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(parsedValue)) {
      return;
    }

    setStats((prev) => {
      if (counterId === 'apps_deployed') {
        return { ...prev, appsDeployed: parsedValue };
      }
      if (counterId === 'signin_clicks') {
        return { ...prev, signinClicks: parsedValue };
      }
      return prev;
    });
  }, []);

  const fetchStats = useCallback(async (options: FetchStatsOptions = {}): Promise<boolean> => {
    const { silent = false } = options;

    try {
      const response = await fetch('/api/stats/public', {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch stats');
      }

      const data = (await response.json()) as LandingStatValues;
      setStats(data);
      setError(null);
      return true;
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
      return false;
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const getNextDelay = (lastFetchSucceeded: boolean): number => {
      const baseInterval = realtimeConnectedRef.current
        ? POLL_INTERVAL_HEALTHY_MS
        : POLL_INTERVAL_DEGRADED_MS;

      const visibilityInterval = document.visibilityState === 'hidden'
        ? Math.max(baseInterval, POLL_INTERVAL_HIDDEN_MS)
        : baseInterval;

      const failureMultiplier = lastFetchSucceeded
        ? 1
        : 2 ** pollingFailureCountRef.current;

      return Math.min(visibilityInterval * failureMultiplier, POLL_MAX_BACKOFF_MS);
    };

    const scheduleNextPoll = (delayMs: number) => {
      timeoutId = window.setTimeout(async () => {
        const succeeded = await fetchStats({ silent: true });
        if (succeeded) {
          pollingFailureCountRef.current = 0;
        } else {
          pollingFailureCountRef.current = Math.min(
            pollingFailureCountRef.current + 1,
            MAX_FAILURE_BACKOFF_STEPS
          );
        }

        if (!cancelled) {
          scheduleNextPoll(getNextDelay(succeeded));
        }
      }, delayMs);
    };

    void fetchStats();
    scheduleNextPoll(POLL_INTERVAL_DEGRADED_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        pollingFailureCountRef.current = 0;
        void fetchStats({ silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchStats]);

  // Subscribe to realtime updates for site_counters
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      return;
    }

    const supabase = getSupabaseClient();
    let channel: RealtimeChannel | null = null;

    try {
      const channelName = `site_counters_changes_${Math.random().toString(36).slice(2, 12)}`;
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'site_counters',
          },
          (payload) => {
            const { id, value } = payload.new as { id: string; value: number };
            applyCounterUpdate(id, value);
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'site_counters',
          },
          (payload) => {
            const { id, value } = payload.new as { id: string; value: number };
            applyCounterUpdate(id, value);
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            realtimeConnectedRef.current = true;
            pollingFailureCountRef.current = 0;
            void fetchStats({ silent: true });
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            realtimeConnectedRef.current = false;
            // Fallback fetch keeps counters fresh even if websocket delivery drops.
            void fetchStats({ silent: true });
          }
        });
    } catch (err) {
      realtimeConnectedRef.current = false;
      console.error('Failed to subscribe to realtime updates:', err);
    }

    return () => {
      realtimeConnectedRef.current = false;
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [applyCounterUpdate, fetchStats]);

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
