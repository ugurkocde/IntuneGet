"use client";

import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { motion, AnimatePresence, useInView, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CheckCircle, Loader2, Circle } from "lucide-react";
import { springPresets } from "@/lib/animations/variants";
import {
  getFeedMotionConfig,
  createInitialFeedItems,
  tickFeedItems,
  type AppDefinition,
  type FeedAnimationMode,
  type FeedItem,
  type StageState,
  type ViewportMode,
} from "@/lib/landing/deploymentFeedMotion";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TICK_INTERVAL_MS = 80;
const HERO_CALM_TICK_INTERVAL_MS = 100;

const STAGE_LABELS = [
  { label: "Downloaded", shortLabel: "Downloaded", activeLabel: "Downloading…", activeShortLabel: "Downloading…" },
  { label: "Packaged", shortLabel: "Packaged", activeLabel: "Packaging…", activeShortLabel: "Packaging…" },
  { label: "Uploaded", shortLabel: "Uploaded", activeLabel: "Uploading…", activeShortLabel: "Uploading…" },
  { label: "Deployed", shortLabel: "Deployed", activeLabel: "Deploying…", activeShortLabel: "Deploying…" },
] as const;

// ---------------------------------------------------------------------------
// App Pool (13 apps)
// ---------------------------------------------------------------------------

const APP_POOL: AppDefinition[] = [
  { name: "Google Chrome", icon: "/icons/Google.Chrome/icon-64.png", alt: "Google Chrome deployment" },
  { name: "Microsoft Teams", icon: "/icons/Microsoft.Teams/icon-64.png", alt: "Microsoft Teams deployment" },
  { name: "Slack", icon: "/icons/SlackTechnologies.Slack/icon-64.png", alt: "Slack deployment" },
  { name: "Firefox", icon: "/icons/Mozilla.Firefox/icon-64.png", alt: "Firefox deployment" },
  { name: "VS Code", icon: "/icons/Microsoft.VisualStudioCode/icon-64.png", alt: "VS Code deployment" },
  { name: "VLC Player", icon: "/icons/VideoLAN.VLC/icon-64.png", alt: "VLC Player deployment" },
  { name: "7-Zip", icon: "/icons/7zip.7zip/icon-64.png", alt: "7-Zip deployment" },
  { name: "Notepad++", icon: "/icons/Notepad++.Notepad++/icon-64.png", alt: "Notepad++ deployment" },
  { name: "Acrobat Reader", icon: "/icons/Adobe.Acrobat.Reader.64-bit/icon-64.png", alt: "Acrobat Reader deployment" },
  { name: "Python 3.12", icon: "/icons/Python.Python.3.12/icon-64.png", alt: "Python 3.12 deployment" },
  { name: "Git", icon: "/icons/Git.Git/icon-64.png", alt: "Git deployment" },
  { name: "Obsidian", icon: "/icons/Obsidian.Obsidian/icon-64.png", alt: "Obsidian deployment" },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getStageState(stageIndex: number, itemStageIndex: number): StageState {
  if (stageIndex < itemStageIndex) return "complete";
  if (stageIndex === itemStageIndex) return "active";
  return "waiting";
}

function createItemId(appName: string): string {
  return `${appName.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StageIcon({ state }: { state: StageState }) {
  if (state === "complete") {
    return (
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={springPresets.bouncy}
      >
        <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
      </motion.div>
    );
  }
  if (state === "active") {
    return (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="w-3.5 h-3.5 text-accent-cyan" />
      </motion.div>
    );
  }
  return <Circle className="w-3 h-3 text-overlay/20" />;
}

function StageIconStatic({ state }: { state: StageState }) {
  if (state === "complete") {
    return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
  }
  return <Circle className="w-3 h-3 text-overlay/20" />;
}

// ---------------------------------------------------------------------------
// ProgressBar (CSS-driven for perf)
// ---------------------------------------------------------------------------

function ProgressBar({ progress, calm = false }: { progress: number; calm?: boolean }) {
  return (
    <div className="mt-0.5 h-0.5 w-full rounded-full bg-overlay/[0.08]">
      <div
        className={cn(
          "h-full rounded-full bg-[linear-gradient(90deg,#06b6d4_0%,#0891b2_72%,#7c3aed_100%)] transition-[width] ease-linear",
          calm
            ? "shadow-[0_0_6px_rgba(8,145,178,0.16)] duration-100"
            : "shadow-[0_0_8px_rgba(8,145,178,0.24)] duration-75"
        )}
        style={{ width: `${Math.min(progress * 100, 100)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppRow (memoized)
// ---------------------------------------------------------------------------

interface AppRowProps {
  item: FeedItem;
  compact?: boolean;
  isMobile?: boolean;
  mode?: FeedAnimationMode;
}

const AppRow = memo(function AppRow({ item, compact = false, isMobile = false, mode = "default" }: AppRowProps) {
  const allComplete = item.status === "completing" || item.status === "exiting";
  const isProcessing = item.status === "processing";
  const isHeroCalm = mode === "heroCalm";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border transition-[box-shadow,border-color,background-color] duration-500",
        compact ? "p-3" : isHeroCalm ? "p-3.5" : "p-3",
        allComplete
          ? "border-emerald-200/60"
          : isProcessing
            ? isHeroCalm
              ? "border-accent-cyan/35 bg-bg-elevated shadow-[0_0_0_1px_rgba(8,145,178,0.08),0_8px_18px_rgba(8,145,178,0.06)] processing-gradient-calm"
              : "border-accent-cyan/45 bg-bg-elevated shadow-[0_0_0_1px_rgba(8,145,178,0.12),0_10px_24px_rgba(8,145,178,0.08)] processing-gradient"
            : "border-overlay/10 bg-bg-elevated"
      )}
    >
      {isProcessing && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: isHeroCalm ? 0.22 : 0.35 }}
          animate={isHeroCalm ? { opacity: [0.18, 0.3, 0.18] } : { opacity: [0.28, 0.42, 0.28] }}
          transition={{
            duration: isHeroCalm ? (isMobile ? 5.2 : 4.6) : (isMobile ? 4.2 : 3.6),
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      )}

      <div className="relative z-10">
        {/* App header */}
        <div className="mb-2 flex items-center gap-2">
          <div
            className={cn(
              "flex flex-shrink-0 items-center justify-center rounded-md bg-overlay/[0.06]",
              compact ? "h-6 w-6" : "h-7 w-7"
            )}
          >
            <img
              src={item.app.icon}
              alt={item.app.alt}
              width={20}
              height={20}
              className={cn("object-contain", compact ? "h-4 w-4" : "h-5 w-5")}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <span
            className={cn(
              "font-medium text-text-primary",
              compact ? "text-xs" : "text-sm"
            )}
          >
            {item.app.name}
          </span>
          {allComplete && (
            <motion.span
              className="ml-auto text-[10px] font-medium text-emerald-600"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={springPresets.bouncy}
            >
              Complete
            </motion.span>
          )}
        </div>

        {/* Stages */}
        <div className="grid grid-cols-4 gap-1.5">
          {STAGE_LABELS.map((stage, si) => {
            const state: StageState = allComplete ? "complete" : getStageState(si, item.stageIndex);
            const isActive = state === "active" && !allComplete;
            const progress = isActive && si === item.stageIndex ? item.stageProgress : 0;

            return (
              <div key={stage.label} className="flex flex-col">
                <div
                  className={cn(
                    "flex items-center gap-1",
                    state === "complete" && (isHeroCalm ? "text-text-secondary" : "text-text-secondary"),
                    state === "active" && "text-accent-cyan font-medium",
                    state === "waiting" && "text-text-muted"
                  )}
                >
                  <StageIcon state={state} />
                  <span
                    className={cn(
                      "truncate",
                      compact ? (isHeroCalm ? "text-[10px]" : "text-[9px]") : isHeroCalm ? "text-[11px]" : "text-[10px]"
                    )}
                  >
                    <span className="hidden sm:inline">{isActive ? stage.activeLabel : stage.label}</span>
                    <span className="sm:hidden">{isActive ? stage.activeShortLabel : stage.shortLabel}</span>
                  </span>
                </div>
                {isActive && <ProgressBar progress={progress} calm={isHeroCalm} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Static fallback (reduced motion)
// ---------------------------------------------------------------------------

function DeploymentFeedStatic({ className = "", mode = "default" }: { className?: string; mode?: FeedAnimationMode }) {
  const isHeroCalm = mode === "heroCalm";
  const staticApps = APP_POOL.slice(0, 4);
  const mobileApps = APP_POOL.slice(0, 3);

  return (
    <div aria-hidden="true" className={cn("relative mx-auto w-full max-w-4xl", className)}>
      <div className="relative overflow-hidden rounded-xl border border-overlay/[0.06] bg-bg-elevated shadow-soft-xl">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-overlay/10 bg-bg-surface px-3 py-2">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-overlay/20" />
            <div className="h-2.5 w-2.5 rounded-full bg-overlay/20" />
            <div className="h-2.5 w-2.5 rounded-full bg-overlay/20" />
          </div>
          <div className="mx-4 flex-1">
            <div className="mx-auto max-w-md rounded-lg border border-overlay/10 bg-bg-elevated px-3 py-1 text-xs text-text-muted">
              IntuneGet.com/dashboard
            </div>
          </div>
        </div>

        {/* Static feed */}
        <div className={cn("bg-bg-surface/50 p-3 md:p-4", isHeroCalm && "bg-bg-surface/35")}>
          {/* Desktop */}
          <div className="hidden flex-col gap-3 md:flex">
            {staticApps.map((app) => (
              <StaticAppRow key={app.name} app={app} mode={mode} />
            ))}
          </div>
          {/* Mobile */}
          <div className="flex flex-col gap-3 md:hidden">
            {mobileApps.map((app) => (
              <StaticAppRow key={app.name} app={app} compact mode={mode} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaticAppRow({
  app,
  compact = false,
  mode = "default",
}: {
  app: AppDefinition;
  compact?: boolean;
  mode?: FeedAnimationMode;
}) {
  const isHeroCalm = mode === "heroCalm";
  return (
    <div className={cn("rounded-lg border border-emerald-200/60 bg-bg-elevated", compact ? "p-3" : isHeroCalm ? "p-3.5" : "p-3")}>
      <div className="mb-2 flex items-center gap-2">
        <div
          className={cn(
            "flex items-center justify-center rounded-md bg-overlay/[0.06]",
            compact ? "h-6 w-6" : "h-7 w-7"
          )}
        >
          <img
            src={app.icon}
            alt={app.alt}
            width={20}
            height={20}
            className={cn("object-contain", compact ? "h-4 w-4" : "h-5 w-5")}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <span className={cn("font-medium text-text-primary", compact ? "text-xs" : "text-sm")}>{app.name}</span>
        <span className="ml-auto text-[10px] font-medium text-emerald-600">Complete</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {STAGE_LABELS.map((stage) => (
          <div key={stage.label} className="flex items-center gap-1 text-text-secondary">
            <StageIconStatic state="complete" />
            <span
              className={cn(
                "truncate",
                compact ? (isHeroCalm ? "text-[10px]" : "text-[9px]") : isHeroCalm ? "text-[11px]" : "text-[10px]"
              )}
            >
              <span className="hidden sm:inline">{stage.label}</span>
              <span className="sm:hidden">{stage.shortLabel}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface DeploymentFeedProps {
  className?: string;
  mode?: FeedAnimationMode;
}

export function DeploymentFeed({ className = "", mode = "default" }: DeploymentFeedProps) {
  const shouldReduceMotion = useReducedMotion();
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { amount: 0.1 });

  const queueRef = useRef<AppDefinition[]>([]);
  const lastAppNameRef = useRef<string>("");
  const tickRef = useRef<() => void>(undefined);

  const isMobile = viewportMode === "mobile";
  const isHeroCalm = mode === "heroCalm";
  const motionConfig = getFeedMotionConfig(mode, viewportMode);
  const tickIntervalMs = isHeroCalm ? HERO_CALM_TICK_INTERVAL_MS : DEFAULT_TICK_INTERVAL_MS;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateViewportMode = () => setViewportMode(mediaQuery.matches ? "mobile" : "desktop");

    updateViewportMode();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateViewportMode);
      return () => mediaQuery.removeEventListener("change", updateViewportMode);
    }

    mediaQuery.addListener(updateViewportMode);
    return () => mediaQuery.removeListener(updateViewportMode);
  }, []);

  const createId = useCallback((app: AppDefinition) => createItemId(app.name), []);

  const getNextApp = useCallback((): AppDefinition => {
    if (queueRef.current.length === 0) {
      let shuffled = shuffleArray(APP_POOL);

      // Guard against consecutive duplicate at reshuffle boundary.
      if (shuffled[0].name === lastAppNameRef.current && shuffled.length > 1) {
        const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
        [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
      }

      queueRef.current = shuffled;
    }

    const next = queueRef.current.shift()!;
    lastAppNameRef.current = next.name;
    return next;
  }, []);

  useEffect(() => {
    if (shouldReduceMotion) return;

    setFeedItems(
      createInitialFeedItems({
        config: motionConfig,
        stageCount: STAGE_LABELS.length,
        getNextApp,
        createId,
      })
    );
  }, [shouldReduceMotion, motionConfig, getNextApp, createId]);

  tickRef.current = () => {
    setFeedItems((prev) =>
      tickFeedItems({
        prevItems: prev,
        config: motionConfig,
        tickMs: tickIntervalMs,
        stageCount: STAGE_LABELS.length,
        getNextApp,
        createId,
      })
    );
  };

  useEffect(() => {
    if (shouldReduceMotion || !isInView) return;

    const intervalId = setInterval(() => tickRef.current?.(), tickIntervalMs);
    return () => clearInterval(intervalId);
  }, [shouldReduceMotion, isInView, tickIntervalMs]);

  if (shouldReduceMotion) {
    return <DeploymentFeedStatic className={className} mode={mode} />;
  }

  return (
    <div ref={containerRef} aria-hidden="true" className={cn("relative mx-auto w-full max-w-4xl", className)}>
      <motion.div
        className="relative overflow-hidden rounded-xl border border-overlay/[0.06] bg-bg-elevated shadow-soft-xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.4,
          delay: 0.1,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        {/* Ambient FX */}
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
          {isHeroCalm ? (
            <motion.div
              className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(8,145,178,0.14),rgba(124,58,237,0.08)_42%,transparent_72%)] blur-3xl"
              initial={{ opacity: 0.18, scale: 1 }}
              animate={{
                opacity: isMobile ? [0.12, 0.18, 0.12] : [0.14, 0.2, 0.14],
                scale: [1, 1.05, 1],
                x: [0, -8, 0],
                y: [0, 6, 0],
              }}
              transition={{
                duration: isMobile ? 14 : 12,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ) : (
            <>
              <motion.div
                className="absolute -left-16 -top-24 h-64 w-64 rounded-full bg-accent-cyan/20 blur-3xl"
                initial={{ opacity: 0.16, scale: 1 }}
                animate={{
                  opacity: isMobile ? [0.1, 0.16, 0.1] : [0.14, 0.22, 0.14],
                  scale: [1, 1.06, 1],
                  x: [0, 12, 0],
                  y: [0, -8, 0],
                }}
                transition={{
                  duration: isMobile ? 11 : 9,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <motion.div
                className="absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-accent-cyan/10 blur-3xl"
                initial={{ opacity: 0.12, scale: 1 }}
                animate={{
                  opacity: isMobile ? [0.08, 0.14, 0.08] : [0.1, 0.18, 0.1],
                  scale: [1, 1.05, 1],
                  x: [0, -10, 0],
                  y: [0, 8, 0],
                }}
                transition={{
                  duration: isMobile ? 12 : 9.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              {!isMobile && (
                <motion.div
                  className="absolute -left-1/2 top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-overlay/[0.06] to-transparent mix-blend-soft-light"
                  initial={{ x: "-120%" }}
                  animate={{ x: ["-120%", "250%"] }}
                  transition={{
                    duration: 1.15,
                    repeat: Infinity,
                    repeatDelay: 5.85,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                />
              )}
            </>
          )}
        </div>

        {/* Browser chrome */}
        <div
          className={cn(
            "relative z-10 flex items-center gap-2 border-b px-3 py-2",
            isHeroCalm ? "border-overlay/[0.08] bg-overlay/[0.04]" : "border-overlay/10 bg-bg-surface/90 backdrop-blur-[1px]"
          )}
        >
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-overlay/20" />
            <div className="h-2.5 w-2.5 rounded-full bg-overlay/20" />
            <div className="h-2.5 w-2.5 rounded-full bg-overlay/20" />
          </div>
          <div className="mx-4 flex-1">
            <div
              className={cn(
                "mx-auto max-w-md rounded-lg border bg-bg-elevated px-3 py-1 text-xs text-text-muted",
                isHeroCalm ? "border-overlay/[0.07]" : "border-overlay/10"
              )}
            >
              IntuneGet.com/dashboard
            </div>
          </div>
        </div>

        {/* Feed area with fade mask */}
        <div
          className={cn(
            "relative z-10 h-[200px] overflow-hidden p-3 md:h-[300px] md:p-4",
            isHeroCalm ? "bg-bg-surface/35" : "bg-bg-surface/45"
          )}
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)",
          }}
        >
          <AnimatePresence initial={false}>
            {feedItems
              .filter((item) => item.status !== "exiting")
              .map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: motionConfig.enterOffsetY, scale: isHeroCalm ? 0.992 : 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: motionConfig.exitOffsetY, scale: isHeroCalm ? 0.998 : 0.995 }}
                  transition={{
                    opacity: { duration: isHeroCalm ? 0.4 : 0.32, ease: "easeOut" },
                    y: { duration: isHeroCalm ? 0.4 : 0.32, ease: "easeOut" },
                    scale: { duration: isHeroCalm ? 0.34 : 0.28, ease: "easeOut" },
                    layout: {
                      type: "spring",
                      stiffness: isHeroCalm ? 280 : 320,
                      damping: isHeroCalm ? 34 : 32,
                    },
                  }}
                  className="mb-3 last:mb-0"
                >
                  <div className="hidden md:block">
                    <AppRow item={item} isMobile={isMobile} mode={mode} />
                  </div>
                  <div className="block md:hidden">
                    <AppRow item={item} compact isMobile={isMobile} mode={mode} />
                  </div>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
