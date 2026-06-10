"use client";

import { Star, GitFork, Users, ExternalLink } from "lucide-react";
import { Github } from "@/components/icons/brand-icons";
import { useGitHubStats } from "@/hooks/useGitHubStats";
import { CountUp } from "../animations/CountUp";
import { FadeIn } from "../animations/FadeIn";

interface GitHubStatsBarProps {
  className?: string;
  showTitle?: boolean;
}

export function GitHubStatsBar({ className = "", showTitle = true }: GitHubStatsBarProps) {
  const { stars, forks, contributors, isLoading } = useGitHubStats();

  const stats = [
    {
      icon: Star,
      value: stars,
      label: "GitHub Stars",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    },
    {
      icon: GitFork,
      value: forks,
      label: "Forks",
      color: "text-accent-cyan",
      bgColor: "bg-accent-cyan/10",
    },
    {
      icon: Users,
      value: contributors,
      label: "Contributors",
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
    },
  ];

  return (
    <FadeIn className={className}>
      <div className="flex flex-col items-center">
        {showTitle && (
          <p className="text-sm text-text-muted mb-4">
            Join our growing open source community
          </p>
        )}

        <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center sm:gap-4 md:gap-6">
          {stats.map((stat, index) => (
            <a
              key={stat.label}
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 px-2 py-2.5 sm:px-4 rounded-xl bg-bg-elevated border border-overlay/10 hover:border-overlay/15 hover:shadow-card transition-all duration-300"
            >
              <div className={`w-8 h-8 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="text-center sm:text-left">
                <div className="text-lg font-bold text-text-primary">
                  {isLoading ? (
                    <span className="inline-block w-8 h-5 bg-overlay/[0.06] rounded animate-pulse" />
                  ) : (
                    <CountUp end={stat.value} delay={0.1 * index} />
                  )}
                </div>
                <div className="text-xs text-text-muted">{stat.label}</div>
              </div>
            </a>
          ))}

          {/* Repo CTA */}
          <a
            href="https://github.com/ugurkocde/IntuneGet"
            target="_blank"
            rel="noopener noreferrer"
            className="group col-span-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-text-primary text-bg-elevated hover:bg-text-primary/90 transition-all duration-300"
          >
            <Github className="w-4 h-4" />
            <span className="text-sm font-medium">View Repo</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </div>
    </FadeIn>
  );
}
