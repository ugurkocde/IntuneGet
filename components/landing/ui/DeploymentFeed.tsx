"use client";

import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CheckCircle, Loader2, Circle } from "lucide-react";
import { springPresets } from "@/lib/animations/variants";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 100;
const STAGE_DURATION_MS = 1400;
const COMPLETE_HOLD_MS = 800;
const ENTER_ANIMATION_MS = 300;
const EXIT_ANIMATION_MS = 350;
const OVERLAP_THRESHOLD = 2; // new item enters when prev reaches stageIndex >= 2

const STAGE_LABELS = [
  { label: "Downloaded", shortLabel: "Downloaded" },
  { label: "Packaged (.intunewin)", shortLabel: "Packaged" },
  { label: "Uploaded to Intune", shortLabel: "Uploaded" },
  { label: "Deployed", shortLabel: "Deployed" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AppDefinition {
  name: string;
  icon: string;
  alt: string;
}

type StageState = "waiting" | "active" | "complete";

type FeedItemStatus = "entering" | "processing" | "completing" | "exiting";

interface FeedItem {
  id: string;
  app: AppDefinition;
  stageIndex: number;
  stageProgress: number;
  status: FeedItemStatus;
  holdElapsed: number; // ms elapsed in completing state
  enterElapsed: number; // ms elapsed in entering state
}

// ---------------------------------------------------------------------------
// App Pool (13 apps)
// ---------------------------------------------------------------------------

const APP_POOL: AppDefinition[] = [
  { name: "Google Chrome", icon: "/icons/Google.Chrome/icon-64-0.png", alt: "Google Chrome deployment" },
  { name: "Microsoft Teams", icon: "/icons/Microsoft.Teams/icon-64.png", alt: "Microsoft Teams deployment" },
  { name: "Slack", icon: "/icons/SlackTechnologies.Slack/icon-64.png", alt: "Slack deployment" },
  { name: "Firefox", icon: "/icons/Mozilla.Firefox/icon-64.png", alt: "Firefox deployment" },
  { name: "VS Code", icon: "/icons/Microsoft.VisualStudioCode/icon-64.png", alt: "VS Code deployment" },
  { name: "Zoom", icon: "/icons/Zoom.Zoom/icon-64.png", alt: "Zoom deployment" },
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
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getStageState(stageIndex: number, itemStageIndex: number, itemStageProgress: number): StageState {
  if (stageIndex < itemStageIndex) return "complete";
  if (stageIndex === itemStageIndex && itemStageProgress > 0) return "active";
  if (stageIndex === itemStageIndex && itemStageProgress === 0) return "active";
  return "waiting";
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
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      >
        <Loader2 className="w-3.5 h-3.5 text-accent-cyan" />
      </motion.div>
    );
  }
  return <Circle className="w-3 h-3 text-stone-300" />;
}

function StageIconStatic({ state }: { state: StageState }) {
  if (state === "complete") {
    return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
  }
  return <Circle className="w-3 h-3 text-stone-300" />;
}

// ---------------------------------------------------------------------------
// ProgressBar (CSS-driven for perf)
// ---------------------------------------------------------------------------

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-0.5 bg-stone-200/60 rounded-full w-full mt-0.5">
      <div
        className="h-full bg-accent-cyan rounded-full transition-[width] duration-100 ease-linear"
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
}

const AppRow = memo(function AppRow({ item, compact = false }: AppRowProps) {
  const allComplete = item.status === "completing" || item.status === "exiting";

  return (
    <div
      className={cn(
        "bg-white rounded-lg border p-3",
        allComplete
          ? "border-emerald-200/60"
          : item.status === "processing"
            ? "border-accent-cyan/30"
            : "border-stone-200"
      )}
    >
      {/* App header */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "bg-stone-100 rounded-md flex items-center justify-center flex-shrink-0",
            compact ? "w-6 h-6" : "w-7 h-7"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.app.icon}
            alt={item.app.alt}
            className={cn("object-contain", compact ? "w-4 h-4" : "w-5 h-5")}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <span
          className={cn(
            "font-medium text-stone-800",
            compact ? "text-xs" : "text-sm"
          )}
        >
          {item.app.name}
        </span>
        {allComplete && (
          <motion.span
            className="ml-auto text-[10px] text-emerald-600 font-medium"
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
          const state: StageState = allComplete
            ? "complete"
            : getStageState(si, item.stageIndex, item.stageProgress);
          const isActive = state === "active" && !allComplete;
          const progress = isActive && si === item.stageIndex ? item.stageProgress : 0;

          return (
            <div key={stage.label} className="flex flex-col">
              <div
                className={cn(
                  "flex items-center gap-1",
                  state === "complete" && "text-stone-700",
                  state === "active" && "text-accent-cyan",
                  state === "waiting" && "text-stone-400"
                )}
              >
                <StageIcon state={state} />
                <span className={cn("truncate", compact ? "text-[9px]" : "text-[10px]")}>
                  <span className="hidden sm:inline">{stage.label}</span>
                  <span className="sm:hidden">{stage.shortLabel}</span>
                </span>
              </div>
              {isActive && <ProgressBar progress={progress} />}
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Static fallback (reduced motion)
// ---------------------------------------------------------------------------

function DeploymentFeedStatic({ className = "" }: { className?: string }) {
  const staticApps = APP_POOL.slice(0, 4);
  const mobileApps = APP_POOL.slice(0, 3);

  return (
    <div className={cn("relative w-full mx-auto max-w-4xl", className)}>
      <div className="relative bg-white rounded-xl shadow-soft-xl border border-stone-200/60 overflow-hidden">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 bg-stone-50 border-b border-stone-200 px-3 py-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
          </div>
          <div className="flex-1 mx-4">
            <div className="bg-white border border-stone-200 rounded-lg px-3 py-1 text-xs text-stone-500 max-w-md mx-auto">
              IntuneGet.com/dashboard
            </div>
          </div>
        </div>

        {/* Static feed */}
        <div className="p-3 md:p-4 bg-stone-50/50">
          {/* Desktop */}
          <div className="hidden md:flex flex-col gap-3">
            {staticApps.map((app) => (
              <StaticAppRow key={app.name} app={app} />
            ))}
          </div>
          {/* Mobile */}
          <div className="flex md:hidden flex-col gap-3">
            {mobileApps.map((app) => (
              <StaticAppRow key={app.name} app={app} compact />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StaticAppRow({ app, compact = false }: { app: AppDefinition; compact?: boolean }) {
  return (
    <div
      className="bg-white rounded-lg border border-emerald-200/60 p-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "bg-stone-100 rounded-md flex items-center justify-center",
            compact ? "w-6 h-6" : "w-7 h-7"
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={app.icon}
            alt={app.alt}
            className={cn("object-contain", compact ? "w-4 h-4" : "w-5 h-5")}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <span className={cn("font-medium text-stone-800", compact ? "text-xs" : "text-sm")}>
          {app.name}
        </span>
        <span className="ml-auto text-[10px] text-emerald-600 font-medium">Complete</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {STAGE_LABELS.map((stage) => (
          <div key={stage.label} className="flex items-center gap-1 text-stone-700">
            <StageIconStatic state="complete" />
            <span className={cn("truncate", compact ? "text-[9px]" : "text-[10px]")}>
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
}

export function DeploymentFeed({ className = "" }: DeploymentFeedProps) {
  const shouldReduceMotion = useReducedMotion();

  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);

  // Shuffle queue ref
  const queueRef = useRef<AppDefinition[]>([]);
  const lastAppNameRef = useRef<string>("");

  const getNextApp = useCallback((): AppDefinition => {
    if (queueRef.current.length === 0) {
      let shuffled = shuffleArray(APP_POOL);
      // Guard against consecutive duplicate at reshuffle boundary
      if (shuffled[0].name === lastAppNameRef.current && shuffled.length > 1) {
        // Swap first with a random later position
        const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
        [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
      }
      queueRef.current = shuffled;
    }
    const next = queueRef.current.shift()!;
    lastAppNameRef.current = next.name;
    return next;
  }, []);

  // Tick function ref to avoid stale closures
  const tickRef = useRef<() => void>();

  // Track if we've initialized to avoid double-start in strict mode
  const initializedRef = useRef(false);

  const VISIBLE_COUNT = 3;

  const makeItem = useCallback(
    (stageIndex: number, stageProgress: number, status: FeedItemStatus): FeedItem => {
      const app = getNextApp();
      return {
        id: `${app.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        app,
        stageIndex,
        stageProgress,
        status,
        holdElapsed: 0,
        enterElapsed: status === "processing" ? ENTER_ANIMATION_MS : 0,
      };
    },
    [getNextApp]
  );

  useEffect(() => {
    if (shouldReduceMotion) return;

    // Seed 3 staggered items so the feed looks active from the start
    if (!initializedRef.current) {
      initializedRef.current = true;
      setFeedItems([
        makeItem(2, 0.4, "processing"),
        makeItem(1, 0.2, "processing"),
        makeItem(0, 0, "entering"),
      ]);
    }
  }, [shouldReduceMotion, makeItem]);

  // Tick logic
  tickRef.current = () => {
    setFeedItems((prev) => {
      let items = prev.map((item) => ({ ...item }));

      for (const item of items) {
        switch (item.status) {
          case "entering": {
            item.enterElapsed += TICK_INTERVAL_MS;
            if (item.enterElapsed >= ENTER_ANIMATION_MS) {
              item.status = "processing";
            }
            break;
          }
          case "processing": {
            item.stageProgress += TICK_INTERVAL_MS / STAGE_DURATION_MS;
            if (item.stageProgress >= 1) {
              if (item.stageIndex >= STAGE_LABELS.length - 1) {
                // Last stage complete
                item.stageProgress = 1;
                item.status = "completing";
                item.holdElapsed = 0;
              } else {
                // Move to next stage
                item.stageProgress = 0;
                item.stageIndex += 1;
              }
            }
            break;
          }
          case "completing": {
            item.holdElapsed += TICK_INTERVAL_MS;
            if (item.holdElapsed >= COMPLETE_HOLD_MS) {
              item.status = "exiting";
            }
            break;
          }
          case "exiting": {
            // Will be removed after animation
            break;
          }
        }
      }

      // Maintain exactly VISIBLE_COUNT non-exiting items
      const visibleCount = items.filter((i) => i.status !== "exiting").length;
      for (let i = visibleCount; i < VISIBLE_COUNT; i++) {
        const nextApp = getNextApp();
        items.push({
          id: `${nextApp.name.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          app: nextApp,
          stageIndex: 0,
          stageProgress: 0,
          status: "entering",
          holdElapsed: 0,
          enterElapsed: 0,
        });
      }

      // Remove exiting items after animation completes
      items = items.filter((item) => {
        if (item.status === "exiting" && item.holdElapsed > COMPLETE_HOLD_MS + EXIT_ANIMATION_MS) {
          return false;
        }
        // Track exit duration in holdElapsed (reusing field)
        if (item.status === "exiting") {
          item.holdElapsed += TICK_INTERVAL_MS;
        }
        return true;
      });

      return items;
    });
  };

  // Single interval drives everything
  useEffect(() => {
    if (shouldReduceMotion) return;
    const id = setInterval(() => tickRef.current?.(), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [shouldReduceMotion]);

  // Reduced motion: static fallback
  if (shouldReduceMotion) {
    return <DeploymentFeedStatic className={className} />;
  }

  return (
    <div className={cn("relative w-full mx-auto max-w-4xl", className)}>
      <motion.div
        className="relative bg-white rounded-xl shadow-soft-xl border border-stone-200/60 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: 0.4,
          delay: 0.1,
          ease: [0.25, 0.46, 0.45, 0.94],
        }}
      >
        {/* Browser chrome */}
        <div className="flex items-center gap-2 bg-stone-50 border-b border-stone-200 px-3 py-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
            <div className="w-2.5 h-2.5 rounded-full bg-stone-300" />
          </div>
          <div className="flex-1 mx-4">
            <div className="bg-white border border-stone-200 rounded-lg px-3 py-1 text-xs text-stone-500 max-w-md mx-auto">
              IntuneGet.com/dashboard
            </div>
          </div>
        </div>

        {/* Feed area with fade mask */}
        <div
          className="p-3 md:p-4 bg-stone-50/50 h-[200px] md:h-[300px] overflow-hidden"
          style={{
            maskImage: "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent, black 16px, black calc(100% - 16px), transparent)",
          }}
        >
          <AnimatePresence initial={false}>
            {feedItems
              .filter((item) => item.status !== "exiting")
              .map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{
                    opacity: { duration: 0.3, ease: "easeOut" },
                    y: { duration: 0.3, ease: "easeOut" },
                    layout: { type: "spring", stiffness: 400, damping: 30 },
                  }}
                  className="mb-3 last:mb-0"
                >
                  {/* Desktop */}
                  <div className="hidden md:block">
                    <AppRow item={item} />
                  </div>
                  {/* Mobile */}
                  <div className="block md:hidden">
                    <AppRow item={item} compact />
                  </div>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
