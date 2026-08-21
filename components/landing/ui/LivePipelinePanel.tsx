"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { T, Var, useGT, useLocale } from "gt-next";
import { useReducedMotion } from "framer-motion";
import { AppIcon } from "@/components/AppIcon";
import { cn } from "@/lib/utils";
import type { QaLivePhase, QaLiveResponse } from "@/types/qa";

/**
 * Live hero panel showing the real public QA pipeline: the current run as a
 * CI-style stepper plus the most recent results, polled from /api/qa/live.
 * Renders a calm placeholder until the first poll resolves, re-renders only
 * when the payload meaningfully changes, pauses while the tab is hidden, and
 * keeps the last good snapshot when a poll fails.
 */

const POLL_INTERVAL_MS = 8000;

// The runner's nine phases grouped into five display steps.
const STEP_INDEX: Record<QaLivePhase, number> = {
  queued: 0,
  scanning_installer: 0,
  preparing_package: 0,
  restoring_vm: 0,
  installing: 1,
  detecting_install: 2,
  uninstalling: 3,
  verifying_removal: 4,
  publishing: 4,
};

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, "0")}s` : `${rest}s`;
}

function formatAgo(iso: string, nowMs: number, locale: string | undefined): string {
  const elapsedSec = Math.max(0, (nowMs - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  if (elapsedSec < 60) return rtf.format(0, "minute");
  if (elapsedSec < 3600) return rtf.format(-Math.round(elapsedSec / 60), "minute");
  if (elapsedSec < 86400) return rtf.format(-Math.round(elapsedSec / 3600), "hour");
  return rtf.format(-Math.round(elapsedSec / 86400), "day");
}

interface StepRowProps {
  label: React.ReactNode;
  state: "done" | "active" | "pending";
  detail: React.ReactNode;
  isLast: boolean;
  reduceMotion: boolean;
}

function StepRow({ label, state, detail, isLast, reduceMotion }: StepRowProps) {
  return (
    <div className="relative flex min-h-9 items-center gap-3">
      {!isLast && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute bottom-[-8px] left-[10px] top-[26px] w-0.5",
            state === "done" ? "bg-status-success/30" : "bg-overlay/[0.08]"
          )}
        />
      )}
      <span
        className={cn(
          "z-10 grid h-[22px] w-[22px] flex-shrink-0 place-items-center rounded-full",
          state === "done" && "bg-status-success/15 text-status-success",
          state === "active" &&
            cn(
              "border-2 border-accent-cyan/30 border-t-accent-cyan bg-bg-elevated",
              !reduceMotion && "animate-spin [animation-duration:0.9s]"
            ),
          state === "pending" && "border-2 border-overlay/[0.12] bg-bg-elevated"
        )}
      >
        {state === "done" && <Check aria-hidden="true" className="h-3 w-3" />}
      </span>
      <span
        className={cn(
          "text-[13px] font-medium",
          state === "pending" ? "text-text-muted" : "text-text-primary"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "ml-auto max-w-[55%] truncate font-mono text-[11.5px] tabular-nums",
          state === "pending" ? "text-text-muted" : "text-text-secondary"
        )}
      >
        {detail}
      </span>
    </div>
  );
}

function OutcomePill({ outcome }: { outcome: "running" | "queued" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold",
        outcome === "running" && "bg-accent-cyan/10 text-accent-cyan",
        outcome === "queued" && "bg-overlay/[0.05] text-text-secondary"
      )}
    >
      {outcome === "running" ? <T>Running</T> : <T>Queued</T>}
    </span>
  );
}

export function LivePipelinePanel() {
  const t = useGT();
  const localeTag = useLocale() || undefined;
  const reduceMotion = useReducedMotion() ?? false;
  const [snapshot, setSnapshot] = useState<QaLiveResponse | null>(null);
  // Self-hosted installs keep the live feed disabled (404 from the host
  // gate) and outages return errors; in both cases fall back to a static
  // explainer instead of showing a connecting state forever.
  const [disabled, setDisabled] = useState(false);
  const gateClosedRef = useRef(false);
  const failCountRef = useRef(0);
  const hasDataRef = useRef(false);
  const renderKeyRef = useRef("");
  // Wall-clock moment the current snapshot arrived, so relative times can
  // keep advancing between polls instead of freezing at the payload time.
  const receivedAtRef = useRef(0);
  const [, setClockTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) setClockTick((tick) => tick + 1);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // A cold failure (never any data) falls back to the explainer after a few
    // attempts; once a snapshot arrived, transient failures keep showing it.
    const recordFailure = () => {
      failCountRef.current += 1;
      if (!hasDataRef.current && failCountRef.current >= 3) setDisabled(true);
    };

    const poll = async () => {
      if (document.hidden || gateClosedRef.current) return;
      try {
        const response = await fetch("/api/qa/live", { cache: "no-store" });
        if (cancelled) return;
        if (response.status === 404 || response.status === 403) {
          gateClosedRef.current = true;
          setDisabled(true);
          return;
        }
        if (!response.ok) {
          recordFailure();
          return;
        }
        failCountRef.current = 0;
        hasDataRef.current = true;
        setDisabled(false);
        const data = (await response.json()) as QaLiveResponse;
        // Only re-render when something meaningful changed, so the panel
        // stays calm between polls.
        const key = JSON.stringify([
          data.current?.wingetId,
          data.current?.phase,
          data.current ? Math.floor((data.current.elapsedSeconds ?? 0) / 30) : null,
          data.recent[0]?.testedAtUtc,
          data.queue.count,
          data.queue.next[0]?.wingetId,
        ]);
        if (key !== renderKeyRef.current && !cancelled) {
          renderKeyRef.current = key;
          receivedAtRef.current = Date.now();
          setSnapshot(data);
        }
      } catch {
        if (!cancelled) recordFailure();
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const stepLabels = [
    <T key="prepare">Prepare</T>,
    <T key="install">Install</T>,
    <T key="detect">Detect</T>,
    <T key="uninstall">Uninstall</T>,
    <T key="verify">Verify</T>,
  ];

  const phaseDetail: Record<QaLivePhase, string> = {
    queued: t("queued"),
    scanning_installer: t("VirusTotal scan"),
    preparing_package: t("building package"),
    restoring_vm: t("restoring VM"),
    installing: t("installing"),
    detecting_install: t("checking detection"),
    uninstalling: t("uninstalling"),
    verifying_removal: t("residual scan"),
    publishing: t("publishing results"),
  };

  const nowMs = snapshot
    ? Date.parse(snapshot.serverTime) + (Date.now() - receivedAtRef.current)
    : 0;
  const current = snapshot?.current ?? null;
  const recent = snapshot?.recent ?? [];
  const lastRun = recent[0] ?? null;
  // Between runs, feature the next queued app instead of a stale finished run.
  const nextUp = !current && snapshot ? (snapshot.queue.next[0] ?? null) : null;

  if (disabled) {
    // Static explainer for installs without the public live feed.
    return (
      <div className="overflow-hidden rounded-2xl border border-overlay/[0.08] bg-bg-elevated shadow-soft-lg">
        <div className="flex items-center justify-between gap-3 border-b border-overlay/[0.06] px-4 py-3 md:px-5">
          <span className="text-[13.5px] font-semibold text-text-primary">
            <T>QA pipeline</T>
          </span>
          <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-overlay/[0.08] bg-overlay/[0.03] px-2.5 py-1 text-[11.5px] font-semibold text-text-secondary">
            <T>Public QA</T>
          </span>
        </div>
        <div className="px-4 pb-3 pt-3.5 md:px-5">
          <p className="mb-2.5 text-sm text-text-secondary">
            <T id="hero.pipeline.explainer">
              Every package goes through the same automated run on a real machine:
            </T>
          </p>
          {stepLabels.map((label, index) => (
            <StepRow
              key={index}
              label={label}
              state="done"
              detail=""
              isLast={index === stepLabels.length - 1}
              reduceMotion={reduceMotion}
            />
          ))}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-overlay/[0.06] bg-overlay/[0.02] px-4 py-2.5 text-xs md:px-5">
          <Link
            href="/qa"
            className="font-semibold text-accent-cyan transition-colors hover:text-accent-cyan-dim"
          >
            <T>QA dashboard</T> →
          </Link>
        </div>
      </div>
    );
  }

  // Featured slot: the live run, else the next queued app, else the most
  // recent completed run (only when the queue is empty too).
  const featured = current
    ? {
        wingetId: current.wingetId,
        displayName: current.displayName,
        kindLine: `${current.wingetId} @ ${current.version} · ${formatDuration(current.elapsedSeconds ?? 0)}`,
        activeStep: STEP_INDEX[current.phase] ?? 0,
        activeDetail: phaseDetail[current.phase] ?? current.phase,
        outcome: "running" as const,
      }
    : nextUp
      ? {
          wingetId: nextUp.wingetId,
          displayName: nextUp.displayName,
          kindLine: `${nextUp.wingetId} @ ${nextUp.version}`,
          activeStep: -1,
          activeDetail: "",
          outcome: "queued" as const,
        }
      : lastRun
        ? {
            wingetId: lastRun.wingetId,
            displayName: lastRun.displayName,
            kindLine: `${lastRun.wingetId} @ ${lastRun.testedVersion}${
              lastRun.durationSeconds != null ? ` · ${formatDuration(lastRun.durationSeconds)}` : ""
            }`,
            activeStep: stepLabels.length,
            activeDetail: "",
            outcome: "done" as const,
          }
        : null;

  // Recent rows; skip the first entry only when it is the featured item.
  const recentRows = (current || nextUp ? recent : recent.slice(1)).slice(0, 3);

  return (
    <div className="overflow-hidden rounded-2xl border border-overlay/[0.08] bg-bg-elevated shadow-soft-lg">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-overlay/[0.06] px-4 py-3 md:px-5">
        <span className="text-[13.5px] font-semibold text-text-primary">
          <T>Live packaging pipeline</T>
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold tabular-nums",
            current
              ? "border-accent-cyan/25 bg-accent-cyan/10 text-accent-cyan"
              : "border-overlay/[0.08] bg-overlay/[0.03] text-text-secondary"
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              current ? "bg-accent-cyan" : "bg-text-muted",
              current && !reduceMotion && "animate-pulse"
            )}
          />
          {snapshot === null ? (
            <T>Connecting…</T>
          ) : current ? (
            <T>Running</T>
          ) : lastRun ? (
            <>
              <T>Live</T>
              <span aria-hidden="true">·</span>
              {formatAgo(lastRun.testedAtUtc, nowMs, localeTag)}
            </>
          ) : (
            <T>Live</T>
          )}
        </span>
      </div>

      {/* Featured run */}
      <div className="px-4 pb-1 pt-3.5 md:px-5">
        <div className="mb-2.5 flex items-center gap-3">
          {featured ? (
            <AppIcon packageId={featured.wingetId} packageName={featured.displayName} size="sm" />
          ) : (
            <div className="h-8 w-8 flex-shrink-0 rounded-lg bg-overlay/[0.06]" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {featured ? featured.displayName : t("Connecting to pipeline…")}
            </p>
            <p className="truncate font-mono text-[11px] tabular-nums text-text-muted">
              {featured ? featured.kindLine : <T>Public QA · live</T>}
            </p>
          </div>
          {featured && featured.outcome !== "done" && (
            <span className="ml-auto flex-shrink-0">
              <OutcomePill outcome={featured.outcome} />
            </span>
          )}
        </div>
        <div>
          {stepLabels.map((label, index) => {
            const activeStep = featured?.activeStep ?? -1;
            const state =
              index < activeStep ? "done" : index === activeStep ? "active" : "pending";
            return (
              <StepRow
                key={index}
                label={label}
                state={state}
                detail={
                  state === "done" ? (
                    <T>done</T>
                  ) : state === "active" ? (
                    featured?.activeDetail
                  ) : (
                    <T>queued</T>
                  )
                }
                isLast={index === stepLabels.length - 1}
                reduceMotion={reduceMotion}
              />
            );
          })}
        </div>
      </div>

      {/* Recent results */}
      <div className="mt-2 border-t border-overlay/[0.06] px-4 pb-1 pt-2.5 md:px-5">
        <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          <T>Recent</T>
        </p>
        {recentRows.length > 0 ? (
          recentRows.map((run) => (
            <div
              key={`${run.wingetId}-${run.testedAtUtc}`}
              className="flex items-center gap-3 border-t border-overlay/[0.04] py-2 first:border-t-0"
            >
              <AppIcon packageId={run.wingetId} packageName={run.displayName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-text-primary">
                  {run.displayName} {run.testedVersion}
                </p>
                <p className="truncate font-mono text-[11px] text-text-muted">
                  {run.durationSeconds != null ? `QA · ${formatDuration(run.durationSeconds)}` : "QA"}
                  {run.virusTotalStatus === "clean" ? ` · ${t("VT clean")}` : ""}
                </p>
              </div>
              <span className="min-w-[9ch] flex-shrink-0 text-right font-mono text-[11px] tabular-nums text-text-muted">
                {formatAgo(run.testedAtUtc, nowMs, localeTag)}
              </span>
            </div>
          ))
        ) : (
          <div className="space-y-2 py-2" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-overlay/[0.05]" />
                <div className="h-3 flex-1 rounded bg-overlay/[0.05]" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-overlay/[0.06] bg-overlay/[0.02] px-4 py-2.5 text-xs text-text-muted md:px-5">
        <span className="tabular-nums">
          {snapshot ? (
            <T id="hero.pipeline.queue">
              Public QA · <Var>{snapshot.queue.count.toLocaleString(localeTag)}</Var> in queue
            </T>
          ) : (
            <T>Public QA</T>
          )}
        </span>
        <Link
          href="/qa"
          className="font-semibold text-accent-cyan transition-colors hover:text-accent-cyan-dim"
        >
          <T>QA dashboard</T> →
        </Link>
      </div>
    </div>
  );
}
