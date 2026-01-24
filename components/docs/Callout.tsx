"use client";

import { AlertCircle, CheckCircle, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type CalloutType = "info" | "warning" | "success" | "error" | "tip";

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
}

const calloutConfig: Record<
  CalloutType,
  {
    icon: typeof Info;
    bgClass: string;
    borderClass: string;
    iconClass: string;
    titleClass: string;
  }
> = {
  info: {
    icon: Info,
    bgClass: "bg-accent-cyan/5",
    borderClass: "border-accent-cyan/20",
    iconClass: "text-accent-cyan",
    titleClass: "text-accent-cyan",
  },
  tip: {
    icon: CheckCircle,
    bgClass: "bg-status-success/5",
    borderClass: "border-status-success/20",
    iconClass: "text-status-success",
    titleClass: "text-status-success",
  },
  success: {
    icon: CheckCircle,
    bgClass: "bg-status-success/5",
    borderClass: "border-status-success/20",
    iconClass: "text-status-success",
    titleClass: "text-status-success",
  },
  warning: {
    icon: AlertTriangle,
    bgClass: "bg-status-warning/5",
    borderClass: "border-status-warning/20",
    iconClass: "text-status-warning",
    titleClass: "text-status-warning",
  },
  error: {
    icon: AlertCircle,
    bgClass: "bg-status-error/5",
    borderClass: "border-status-error/20",
    iconClass: "text-status-error",
    titleClass: "text-status-error",
  },
};

export function Callout({ type = "info", title, children }: CalloutProps) {
  const config = calloutConfig[type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "my-6 rounded-lg border p-4",
        config.bgClass,
        config.borderClass
      )}
    >
      <div className="flex gap-3">
        <Icon className={cn("h-5 w-5 flex-shrink-0 mt-0.5", config.iconClass)} />
        <div className="flex-1 min-w-0">
          {title && (
            <p className={cn("font-semibold mb-1", config.titleClass)}>
              {title}
            </p>
          )}
          <div className="text-sm text-zinc-300 leading-relaxed [&>p]:mb-2 [&>p:last-child]:mb-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
