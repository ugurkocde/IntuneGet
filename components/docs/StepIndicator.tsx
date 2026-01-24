"use client";

import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  step: number;
  title: string;
  children: React.ReactNode;
  isLast?: boolean;
}

export function StepIndicator({
  step,
  title,
  children,
  isLast = false,
}: StepIndicatorProps) {
  return (
    <div className="relative flex gap-4 pb-8">
      {/* Vertical line */}
      {!isLast && (
        <div className="absolute left-5 top-12 bottom-0 w-px bg-gradient-to-b from-accent-cyan/30 to-transparent" />
      )}

      {/* Step number */}
      <div className="relative flex-shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan font-semibold text-sm">
          {step}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pt-1 min-w-0">
        <h3 className="text-lg font-semibold text-white mb-3">{title}</h3>
        <div className="text-zinc-400 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0">
          {children}
        </div>
      </div>
    </div>
  );
}

interface StepsProps {
  children: React.ReactNode;
}

export function Steps({ children }: StepsProps) {
  return <div className="my-6">{children}</div>;
}
