"use client";

import { cn } from "@/lib/utils";

interface GridBackgroundProps {
  className?: string;
  variant?: "dots" | "lines" | "grid";
  opacity?: number;
  children?: React.ReactNode;
}

export function GridBackground({
  className = "",
  variant = "dots",
  opacity = 0.4,
  children,
}: GridBackgroundProps) {
  const patterns = {
    dots: "bg-dots-light",
    lines: "bg-grid-light",
    grid: "bg-[linear-gradient(rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:64px_64px]",
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {/* Grid pattern */}
      <div
        className={cn(
          "absolute inset-0 pointer-events-none",
          patterns[variant]
        )}
        style={{ opacity }}
      />

      {/* Radial fade mask */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 50%, transparent 0%, var(--bg-deepest) 100%)",
        }}
      />

      {/* Content */}
      {children && <div className="relative">{children}</div>}
    </div>
  );
}
