"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  useLandingStats,
  type LandingStatValues,
} from "@/hooks/useLandingStats";
import {
  useGitHubStats,
  type GitHubStatValues,
} from "@/hooks/useGitHubStats";

type LandingStats = ReturnType<typeof useLandingStats>;
type GitHubStats = ReturnType<typeof useGitHubStats>;

interface SharedStats {
  landing: LandingStats;
  github: GitHubStats;
}

const StatsContext = createContext<SharedStats | null>(null);

interface LandingStatsProviderProps {
  initialLandingStats?: LandingStatValues;
  initialGitHubStats?: GitHubStatValues;
  children: ReactNode;
}

/**
 * Runs the landing/GitHub stats hooks exactly once per page so every consumer
 * shares one poll loop and one realtime subscription instead of each mounting
 * its own. Consumers use the useShared* hooks below, which fall back to a
 * component-local hook instance on pages without this provider.
 */
export function LandingStatsProvider({
  initialLandingStats,
  initialGitHubStats,
  children,
}: LandingStatsProviderProps) {
  const landing = useLandingStats(initialLandingStats);
  const github = useGitHubStats(initialGitHubStats);
  const value = useMemo(() => ({ landing, github }), [landing, github]);

  return (
    <StatsContext.Provider value={value}>{children}</StatsContext.Provider>
  );
}

export function useSharedLandingStats(
  initial?: LandingStatValues,
): LandingStats {
  const context = useContext(StatsContext);
  // The local instance stays disabled (no fetching) whenever a provider is
  // present; calling the hook unconditionally keeps hook order stable.
  const local = useLandingStats(initial, { enabled: context === null });
  return context ? context.landing : local;
}

export function useSharedGitHubStats(
  initial?: Partial<GitHubStatValues>,
): GitHubStats {
  const context = useContext(StatsContext);
  const local = useGitHubStats(initial, { enabled: context === null });
  return context ? context.github : local;
}
