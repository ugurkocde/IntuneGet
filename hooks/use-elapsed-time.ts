'use client';

import { useState, useEffect, useRef } from 'react';

interface UseElapsedTimeOptions {
  startTime: string | null;
  endTime?: string | null;
  updateInterval?: number;
}

interface UseElapsedTimeReturn {
  elapsedSeconds: number;
  formattedTime: string;
}

/**
 * Format seconds into human readable time string
 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }

  return `${hours}h`;
}

/**
 * Hook to track elapsed time from a start timestamp
 */
export function useElapsedTime({
  startTime,
  endTime,
  updateInterval = 1000,
}: UseElapsedTimeOptions): UseElapsedTimeReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const startDate = new Date(startTime).getTime();

    const calculateElapsed = () => {
      const endDate = endTime ? new Date(endTime).getTime() : Date.now();
      const elapsed = Math.max(0, Math.floor((endDate - startDate) / 1000));
      setElapsedSeconds(elapsed);
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
  }, [startTime, endTime, updateInterval]);

  return {
    elapsedSeconds,
    formattedTime: formatElapsedTime(elapsedSeconds),
  };
}
