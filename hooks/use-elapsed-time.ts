'use client';

import { useState, useEffect, useRef } from 'react';
import { formatQaDuration } from '@/lib/qa/presentation';

interface UseElapsedTimeOptions {
  startTime: string | null;
  endTime?: string | null;
  serverTime?: string | null;
  updateInterval?: number;
}

interface UseElapsedTimeReturn {
  elapsedSeconds: number;
  formattedTime: string;
}

/**
 * Hook to track elapsed time from a start timestamp
 */
export function useElapsedTime({
  startTime,
  endTime,
  serverTime,
  updateInterval = 1000,
}: UseElapsedTimeOptions): UseElapsedTimeReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const activeStartRef = useRef<string | null>(null);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!startTime) {
      activeStartRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    const startDate = new Date(startTime).getTime();
    const parsedServerTime = serverTime ? new Date(serverTime).getTime() : Number.NaN;
    const serverOffsetMs = Number.isFinite(parsedServerTime) ? parsedServerTime - Date.now() : 0;
    const isNewStart = activeStartRef.current !== startTime;
    activeStartRef.current = startTime;

    const calculateElapsed = () => {
      const endDate = endTime ? new Date(endTime).getTime() : Date.now() + serverOffsetMs;
      const elapsed = Math.max(0, Math.floor((endDate - startDate) / 1000));
      setElapsedSeconds((previous) => isNewStart ? elapsed : Math.max(previous, elapsed));
    };

    // Calculate initial value
    calculateElapsed();

    // If there's no end time, keep updating
    if (!endTime) {
      intervalRef.current = setInterval(calculateElapsed, updateInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [startTime, endTime, serverTime, updateInterval]);

  return {
    elapsedSeconds,
    formattedTime: formatQaDuration(elapsedSeconds),
  };
}
