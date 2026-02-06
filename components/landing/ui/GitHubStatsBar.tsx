"use client";

import { Star, GitFork, Users, ExternalLink } from "lucide-react";
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
      bgColor: "bg-amber-50",
    },
    {
      icon: GitFork,
      value: forks,
      label: "Forks",
      color: "text-accent-cyan",
      bgColor: "bg-cyan-50",
    },
    {
      icon: Users,
      value: contributors,
      label: "Contributors",
      color: "text-violet-500",
      bgColor: "bg-violet-50",
    },
  ];

  return (
    <FadeIn className={className}>
      <div className="flex flex-col items-center">
        {showTitle && (
          <p className="text-sm text-stone-500 mb-4">
            Join our growing open source community
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
          {stats.map((stat, index) => (
            <a
              key={stat.label}
              href="https://github.com/ugurkocde/IntuneGet"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-stone-200 hover:border-stone-300 hover:shadow-card transition-all duration-300"
            >
              <div className={`w-8 h-8 rounded-lg ${stat.bgColor} flex items-center justify-center`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
              <div className="text-left">
                <div className="text-lg font-bold text-stone-900">
                  {isLoading ? (
                    <span className="inline-block w-8 h-5 bg-stone-100 rounded animate-pulse" />
                  ) : (
                    <CountUp end={stat.value} delay={0.1 * index} />
                  )}
                </div>
                <div className="text-xs text-stone-500">{stat.label}</div>
              </div>
            </a>
          ))}

          {/* Star CTA */}
          <a
            href="https://github.com/ugurkocde/IntuneGet"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-4 py-2.5 rounded-xl bg-stone-900 text-white hover:bg-stone-800 transition-all duration-300"
          >
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span className="text-sm font-medium">Star on GitHub</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-60 group-hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </div>
    </FadeIn>
  );
}
