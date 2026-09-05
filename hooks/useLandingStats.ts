'use client';

import { useState, useEffect, useRef, useMemo } from 'react';

export interface LandingStatValues {
  signinClicks: number;
  appsDeployed: number;
  appsSupported: number;
}
interface LandingStats extends LandingStatValues {
  isLoading: boolean;
  error: Error | null;
}
const DEFAULT_STATS = { signinClicks: 1000, appsDeployed: 2000, appsSupported: 10000 };

export function useLandingStats(
  initial?: LandingStatValues,
  { enabled = true }: { enabled?: boolean } = {},
): LandingStats {
  const [stats, setStats] = useState(initial ?? DEFAULT_STATS);
  const [isLoading, setIsLoading] = useState(initial === undefined && enabled);
  const [error, setError] = useState<Error | null>(null);
  const seeded = useRef(initial !== undefined);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout>;
    let realtimeTimer: ReturnType<typeof setTimeout>;
    let stopRealtime: (() => void) | undefined;
    let connected = false;
    let fetching = false;
    let failures = 0;
    let startingRealtime = false;

    const update = (next: LandingStatValues) => setStats(previous =>
      previous.signinClicks === next.signinClicks &&
      previous.appsDeployed === next.appsDeployed &&
      previous.appsSupported === next.appsSupported ? previous : next);

    const poll = async () => {
      if (controller.signal.aborted || document.hidden || fetching) return;
      fetching = true;
      clearTimeout(pollTimer);
      try {
        const response = await fetch('/api/stats/public', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Failed to fetch stats');
        const next = await response.json() as LandingStatValues;
        if (controller.signal.aborted) return;
        update(next);
        setError(null);
        failures = 0;
      } catch (err) {
        if (!controller.signal.aborted) {
          failures = Math.min(failures + 1, 3);
          setError(err instanceof Error ? err : new Error('Failed to fetch stats'));
        }
      } finally {
        fetching = false;
        if (!controller.signal.aborted) {
          setIsLoading(false);
          pollTimer = setTimeout(() => void poll(), Math.min((connected ? 20000 : 8000) * 2 ** failures, 60000));
        }
      }
    };

    const startRealtime = async () => {
      if (startingRealtime || document.hidden || controller.signal.aborted) return;
      startingRealtime = true;
      try {
        // Keep the SDK outside initial bundles, including GitHub-only headers.
        const { subscribeLandingCounters } = await import('@/lib/landing/realtime-counters');
        if (controller.signal.aborted) return;
        stopRealtime = subscribeLandingCounters((id, value) => {
          setStats(previous => {
            const field = id === 'apps_deployed' ? 'appsDeployed' : id === 'signin_clicks' ? 'signinClicks' : null;
            return field && previous[field] !== value ? { ...previous, [field]: value } : previous;
          });
        }, value => { connected = value; });
      } catch { /* Polling remains available if realtime cannot load. */ }
    };

    if (seeded.current) pollTimer = setTimeout(() => void poll(), 20000);
    else void poll();
    realtimeTimer = setTimeout(() => void startRealtime(), 5000);
    const visibilityChanged = () => {
      clearTimeout(pollTimer);
      if (!document.hidden) {
        void poll();
        void startRealtime();
      }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      controller.abort();
      clearTimeout(pollTimer);
      clearTimeout(realtimeTimer);
      stopRealtime?.();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [enabled]);

  return useMemo(() => ({ ...stats, isLoading, error }), [stats, isLoading, error]);
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
