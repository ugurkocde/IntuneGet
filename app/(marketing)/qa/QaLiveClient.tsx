'use client';

import { useState } from 'react';
import Image from 'next/image';
import { T, Var } from 'gt-next';
import {
  AlertTriangle,
  CheckCircle2,
  ListOrdered,
  Loader2,
  Monitor,
  Radio,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { QaDetailsDialog } from '@/components/qa/QaDetailsDialog';
import { QaLiveActivityDialog } from '@/components/qa/QaLiveActivityDialog';
import { QaLiveStepTimeline } from '@/components/qa/QaLiveStepTimeline';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { useElapsedTime } from '@/hooks/use-elapsed-time';
import { useQaLive } from '@/hooks/use-qa';
import {
  formatQaDuration,
  formatRelativeTime,
  getQaFrameState,
  getQaPhasePresentation,
} from '@/lib/qa/presentation';
import { cn } from '@/lib/utils';
import type { QaLivePhase, QaLiveResponse } from '@/types/qa';

function healthTone(state: string): StatusTone {
  if (state === 'healthy' || state === 'testing') return 'success';
  if (state === 'degraded') return 'warning';
  if (state === 'stalled') return 'error';
  return 'neutral';
}

function schedulerIssueLabel(issue: QaLiveResponse['scheduler']['issue']): string | null {
  if (issue === 'github_rate_limit') return 'GitHub temporarily limited WinGet checks; scanning will retry automatically';
  if (issue === 'stalled') return 'Poll did not finish';
  if (issue === 'upstream_error') return 'Upstream polling error';
  return null;
}

function QaPhaseLabel({ phase }: { phase: QaLivePhase }) {
  if (phase === 'queued') return <T>Queued</T>;
  if (phase === 'preparing_package') return <T>Preparing package</T>;
  if (phase === 'restoring_vm') return <T>Restoring golden VM</T>;
  if (phase === 'installing') return <T>Installing</T>;
  if (phase === 'detecting_install') return <T>Testing detection</T>;
  if (phase === 'uninstalling') return <T>Uninstalling</T>;
  if (phase === 'verifying_removal') return <T>Verifying removal</T>;
  return <T>Publishing result</T>;
}

function QaResultStatus({ outcome }: { outcome: 'Passed' | 'Failed' }) {
  const passed = outcome === 'Passed';
  const Icon = passed ? CheckCircle2 : XCircle;

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium text-text-primary">
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          passed ? 'text-status-success' : 'text-status-error'
        )}
        aria-hidden="true"
      />
      <T>{outcome}</T>
    </span>
  );
}

function resultEdgeClass(outcome: 'Passed' | 'Failed'): string {
  return outcome === 'Passed'
    ? 'border-l-status-success/60'
    : 'border-l-status-error/60';
}

function LiveFrameImage({ src, alt }: { src: string; alt: string }) {
  const [visibleSrc, setVisibleSrc] = useState<string | null>(null);

  return (
    <>
      {visibleSrc ? (
        <Image
          src={visibleSrc}
          alt={alt}
          fill
          unoptimized
          loading="eager"
          sizes="(min-width: 1024px) 960px, 100vw"
          className="animate-fade-in object-contain motion-reduce:animate-none"
        />
      ) : null}
      {src !== visibleSrc ? (
        <Image
          src={src}
          alt=""
          aria-hidden="true"
          fill
          unoptimized
          loading="eager"
          sizes="(min-width: 1024px) 960px, 100vw"
          className="object-contain opacity-0"
          onLoad={() => setVisibleSrc(src)}
        />
      ) : null}
    </>
  );
}

function ServiceHealth({ data }: { data: QaLiveResponse }) {
  const runnerAge = formatRelativeTime(data.runner.heartbeatAt, data.serverTime);
  const pollAge = formatRelativeTime(data.scheduler.lastPollAt, data.serverTime);
  const schedulerIssue = schedulerIssueLabel(data.scheduler.issue);
  const hasIncident = data.runner.state === 'stalled' || data.scheduler.state === 'degraded';
  const passCount = data.recent.filter((item) => item.outcome === 'Passed').length;

  return (
    <section
      aria-label="QA service health"
      className={cn(
        'overflow-hidden rounded-2xl border bg-bg-elevated',
        data.runner.state === 'stalled'
          ? 'border-status-error/30 bg-status-error/[0.04]'
          : data.scheduler.state === 'degraded'
            ? 'border-status-warning/30 bg-status-warning/[0.04]'
            : 'border-overlay/10'
      )}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-[1fr_1.35fr_0.8fr_1fr]">
        <div className="flex min-h-16 items-center gap-3 border-b border-overlay/10 px-4 py-3 sm:border-r lg:border-b-0">
          <Server className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-text-muted"><T>Runner</T></p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge tone={healthTone(data.runner.state)}>
                <T>{data.runner.state === 'testing' ? 'Testing' : data.runner.state === 'stalled' ? 'Stalled' : 'Ready'}</T>
              </StatusBadge>
              <span className="text-xs text-text-muted">
                {runnerAge ? <T>Heartbeat <Var>{runnerAge}</Var></T> : <T>No active test</T>}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-h-16 items-center gap-3 border-b border-overlay/10 px-4 py-3 lg:border-b-0 lg:border-r">
          <Radio className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-text-muted"><T>WinGet polling</T></p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <StatusBadge tone={healthTone(data.scheduler.state)}>
                <T>{data.scheduler.state === 'healthy' ? 'Healthy' : data.scheduler.state === 'degraded' ? 'Degraded' : 'Waiting for first scan'}</T>
              </StatusBadge>
              <span className="text-xs text-text-muted">
                {pollAge ? <T>Last scan <Var>{pollAge}</Var></T> : <T>No scan recorded yet</T>}
              </span>
            </div>
          </div>
        </div>

        <div className="flex min-h-16 items-center gap-3 border-b border-overlay/10 px-4 py-3 sm:border-b-0 sm:border-r">
          <ListOrdered className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted"><T>Queue</T></p>
            <p className="mt-1 text-sm font-medium text-text-primary">
              <T><Var>{data.queue.count}</Var> waiting</T>
            </p>
          </div>
        </div>

        <div className="flex min-h-16 items-center gap-3 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-muted"><T>Recent QA</T></p>
            <p className="mt-1 text-sm font-medium text-text-primary">
              {data.recent.length > 0
                ? <T><Var>{passCount}</Var> of <Var>{data.recent.length}</Var> passed</T>
                : <T>No completed tests yet</T>}
            </p>
          </div>
        </div>
      </div>

      {hasIncident && schedulerIssue ? (
        <div className="border-t border-status-warning/20 px-4 py-2 text-xs text-status-warning" role="status">
          <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
          <T>{schedulerIssue}</T>
          {data.scheduler.consecutiveFailures > 1
            ? data.scheduler.issue === 'github_rate_limit'
              ? <> · <T><Var>{data.scheduler.consecutiveFailures}</Var> affected scans</T></>
              : <> · <T><Var>{data.scheduler.consecutiveFailures}</Var> consecutive failures</T></>
            : null}
        </div>
      ) : null}
    </section>
  );
}

function CurrentTest({ data }: { data: QaLiveResponse }) {
  const elapsed = useElapsedTime({
    startTime: data.current?.startedAt ?? null,
    serverTime: data.serverTime,
  });

  if (!data.current) {
    const next = data.queue.next[0];
    if (next) {
      return (
        <section
          className="overflow-hidden rounded-2xl border border-accent-cyan/20 bg-bg-elevated shadow-glow-cyan"
          aria-labelledby="current-test-heading"
          aria-live="polite"
        >
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <AppIcon packageId={next.wingetId} packageName={next.displayName} size="xl" />
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge
                      tone="accent"
                      icon={Loader2}
                      iconClassName="animate-spin motion-reduce:animate-none"
                    >
                      <T>Preparing next test</T>
                    </StatusBadge>
                    <span className="text-xs text-text-muted"><T>Starting automatically</T></span>
                  </div>
                  <h2 id="current-test-heading" className="truncate text-xl font-semibold text-text-primary">
                    {next.displayName}
                  </h2>
                  <p className="truncate text-sm text-text-muted">{next.wingetId}</p>
                </div>
              </div>
              <div className="flex items-center gap-5 sm:text-right">
                <div>
                  <p className="text-xs uppercase tracking-wide text-text-muted"><T>Version</T></p>
                  <p className="font-mono text-sm text-text-primary">{next.version} · {next.architecture}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-text-muted"><T>Queue</T></p>
                  <p className="text-sm font-medium text-accent-cyan"><T>Next</T></p>
                </div>
              </div>
            </div>

            <div
              className="h-0.5 overflow-hidden rounded-full bg-overlay/10"
              role="progressbar"
              aria-label="Waiting for the QA runner to start the next test"
            >
              <div className="h-full w-full animate-shimmer bg-accent-cyan/30 motion-reduce:animate-none" />
            </div>

            <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
              <div
                className="relative -mx-5 aspect-video w-[calc(100%+2.5rem)] overflow-hidden bg-black sm:mx-0 sm:w-auto sm:rounded-xl lg:aspect-auto lg:min-h-[36rem]"
                aria-label={`Preparing the isolated QA VM for ${next.displayName}`}
              >
                <div className="absolute inset-0 animate-shimmer bg-[radial-gradient(circle_at_center,rgba(8,145,178,0.12),transparent_45%)] motion-reduce:animate-none" />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                  <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-cyan">
                    <span className="absolute inset-0 animate-ping rounded-2xl border border-accent-cyan/20 motion-reduce:animate-none" aria-hidden="true" />
                    <Monitor className="h-7 w-7" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="font-medium text-white/85"><T>Preparing a clean test VM</T></p>
                    <p className="mt-1 max-w-md text-sm text-white/50">
                      <T>The runner will start <Var>{next.displayName}</Var> automatically and the live preview will appear here.</T>
                    </p>
                  </div>
                </div>
              </div>

              <QaLiveStepTimeline
                phase="queued"
                className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
              />

              <div className="flex min-h-16 items-center gap-3 rounded-xl border border-overlay/10 bg-bg-surface/45 px-4 py-3 lg:col-start-1 lg:row-start-2">
                <span className="rounded-lg bg-accent-cyan/10 p-2 text-accent-cyan" aria-hidden="true">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-text-primary"><T>Waiting for test evidence</T></span>
                  <span className="mt-0.5 block text-xs text-text-muted"><T>Files, registry activity, and PSADT logs will appear after the test starts.</T></span>
                </span>
              </div>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="rounded-2xl border border-overlay/10 bg-bg-elevated px-5 py-4" aria-labelledby="current-test-heading">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-status-success/10 p-2.5 text-status-success">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="current-test-heading" className="font-semibold text-text-primary"><T>Runner is ready</T></h2>
            <p className="text-sm text-text-secondary">
              <T>{data.queue.count > 0 ? 'Waiting for the next dispatch check.' : 'No application is waiting to be tested.'}</T>
            </p>
          </div>
        </div>
      </section>
    );
  }

  const phase = getQaPhasePresentation(data.current.phase);
  const frameState = getQaFrameState({
    available: data.viewer.available,
    capturedAt: data.viewer.capturedAt,
    serverTime: data.serverTime,
  });
  const executionContext = data.current.executionContext === 'LocalSystem' ? 'Runs as SYSTEM' : 'Runs as user';

  return (
    <section className="overflow-hidden rounded-2xl border border-accent-cyan/20 bg-bg-elevated shadow-glow-cyan" aria-labelledby="current-test-heading">
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <AppIcon packageId={data.current.wingetId} packageName={data.current.displayName} size="xl" />
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <StatusBadge
                  tone="accent"
                  icon={Loader2}
                  iconClassName="animate-spin motion-reduce:animate-none"
                >
                  <QaPhaseLabel phase={data.current.phase} /> · <T>step <Var>{phase.step}</Var> of <Var>{phase.totalSteps}</Var></T>
                </StatusBadge>
                {data.runner.state === 'stalled' ? (
                  <StatusBadge tone="error" icon={AlertTriangle}><T>Needs attention</T></StatusBadge>
                ) : null}
                <span className="text-xs text-text-muted"><T>{executionContext}</T></span>
              </div>
              <h2 id="current-test-heading" className="truncate text-xl font-semibold text-text-primary">{data.current.displayName}</h2>
              <p className="truncate text-sm text-text-muted">{data.current.wingetId}</p>
            </div>
          </div>
          <div className="flex items-center gap-5 sm:text-right">
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted"><T>Version</T></p>
              <p className="font-mono text-sm text-text-primary">{data.current.version} · {data.current.architecture}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted"><T>Elapsed</T></p>
              <p className="font-mono text-lg font-semibold text-accent-cyan">{elapsed.formattedTime}</p>
            </div>
          </div>
        </div>

        <span id="qa-phase-progress-label" className="sr-only">
          <QaPhaseLabel phase={data.current.phase} /> · <T>step <Var>{phase.step}</Var> of <Var>{phase.totalSteps}</Var></T>
        </span>
        <div
          className="h-0.5 overflow-hidden rounded-full bg-overlay/10"
          role="progressbar"
          aria-labelledby="qa-phase-progress-label"
          aria-valuemin={0}
          aria-valuemax={phase.totalSteps}
          aria-valuenow={phase.step}
        >
          <div className="h-full rounded-full bg-accent-cyan transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${phase.progressPercent}%` }} />
        </div>

        <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div
            className="relative -mx-5 aspect-video w-[calc(100%+2.5rem)] overflow-hidden bg-black sm:mx-0 sm:w-auto sm:rounded-xl lg:aspect-auto lg:min-h-[36rem]"
            aria-labelledby="live-console-heading"
          >
            <h3 id="live-console-heading" className="sr-only"><T>Live test VM</T></h3>
            {frameState === 'live' ? (
              <span className="absolute right-4 top-4 z-10 animate-pulse text-xs font-semibold uppercase tracking-[0.16em] text-status-success drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] motion-reduce:animate-none">
                <T>Live</T>
              </span>
            ) : null}
            <div className="absolute inset-0">
              {data.viewer.available && data.viewer.sequence != null && data.viewer.candidateId ? (
                <LiveFrameImage
                  key={data.viewer.candidateId}
                  src={`/api/qa/live/frame?candidate=${encodeURIComponent(data.viewer.candidateId)}&sequence=${data.viewer.sequence}`}
                  alt={`Read-only live view of the isolated QA VM while testing ${data.current.displayName}`}
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                  <Monitor className="h-8 w-8 text-white/25" aria-hidden="true" />
                  <p className="max-w-md text-sm text-white/50"><T>The private host is preparing a safe, read-only VM console view. No keyboard, mouse, clipboard, or audio channel is exposed.</T></p>
                </div>
              )}
            </div>
          </div>
          <QaLiveStepTimeline
            phase={data.current.phase}
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
          />
          <div className="lg:col-start-1 lg:row-start-2">
            <QaLiveActivityDialog
              activity={data.activity}
              log={data.log}
              phase={data.current.phase}
              serverTime={data.serverTime}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardContent() {
  const { data, isLoading, isError, refetch } = useQaLive();
  const [selected, setSelected] = useState<{ wingetId: string; catalogVersion: string } | null>(null);
  const [showFullQueue, setShowFullQueue] = useState(false);

  if (isLoading) {
    return <div className="h-80 animate-pulse rounded-2xl border border-overlay/10 bg-bg-elevated motion-reduce:animate-none" aria-label="Loading live QA status" />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-status-error/20 bg-status-error/5 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-status-error" aria-hidden="true" />
        <p className="font-medium text-text-primary"><T>Live QA status is temporarily unavailable.</T></p>
        <button type="button" onClick={() => refetch()} className="mt-3 min-h-10 rounded-lg border border-overlay/10 px-4 py-2 text-sm text-text-secondary hover:text-text-primary"><T>Try again</T></button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ServiceHealth data={data} />
      <CurrentTest data={data} />

      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-5 sm:p-6" aria-labelledby="queue-heading">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id="queue-heading" className="text-lg font-semibold text-text-primary"><T>Next in queue</T></h2>
            <span className="text-xs text-text-muted"><T>One app tested at a time</T></span>
          </div>
          {data.queue.next.length ? (
            <>
              <ol id="qa-queue-list" className="divide-y divide-overlay/10">
                {data.queue.next.map((item, index) => (
                  <li
                    key={`${item.wingetId}-${item.version}-${item.architecture}`}
                    className={cn('items-center gap-3 py-3', index >= 3 && !showFullQueue ? 'hidden sm:flex' : 'flex')}
                  >
                    <span className="w-5 text-xs tabular-nums text-text-muted">{index + 1}</span>
                    <AppIcon packageId={item.wingetId} packageName={item.displayName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">{item.displayName}</p>
                      <p className="truncate text-xs text-text-muted">{item.version} · {item.architecture}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {data.queue.next.length > 3 ? (
                <button
                  type="button"
                  onClick={() => setShowFullQueue((current) => !current)}
                  className="mt-3 min-h-10 w-full rounded-lg border border-overlay/10 px-3 text-sm text-text-secondary hover:bg-overlay/5 hover:text-text-primary sm:hidden"
                  aria-expanded={showFullQueue}
                  aria-controls="qa-queue-list"
                >
                  {showFullQueue ? <T>Show less</T> : <T>Show all <Var>{data.queue.next.length}</Var></T>}
                </button>
              ) : null}
            </>
          ) : <p className="text-sm text-text-muted"><T>The queue is clear.</T></p>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated" aria-labelledby="recent-heading">
          <div className="flex items-baseline justify-between gap-3 px-5 py-5 sm:px-6">
            <h2 id="recent-heading" className="text-lg font-semibold text-text-primary"><T>Recent results</T></h2>
            <span className="text-xs text-text-muted"><T>Select a result for evidence</T></span>
          </div>

          {data.recent.length ? (
            <>
              <div className="divide-y divide-overlay/10 sm:hidden">
                {data.recent.map((item) => (
                  <button
                    key={`${item.wingetId}-${item.testedVersion}-${item.architecture}`}
                    type="button"
                    onClick={() => setSelected({ wingetId: item.wingetId, catalogVersion: item.catalogVersion })}
                    className={cn(
                      'flex min-h-20 w-full items-center gap-3 border-l-2 px-5 py-3 text-left transition-colors hover:bg-overlay/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan',
                      resultEdgeClass(item.outcome)
                    )}
                  >
                    <AppIcon packageId={item.wingetId} packageName={item.displayName} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">{item.displayName}</span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {item.testedVersion} · {item.architecture} · {formatQaDuration(item.durationSeconds)}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {formatRelativeTime(item.testedAtUtc, data.serverTime) ?? <T>Test time unavailable</T>}
                      </span>
                    </span>
                    <QaResultStatus outcome={item.outcome} />
                  </button>
                ))}
              </div>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-y border-overlay/10 text-xs text-text-muted">
                    <tr>
                      <th className="px-6 py-3 font-medium"><T>Application</T></th>
                      <th className="px-3 py-3 font-medium"><T>Result</T></th>
                      <th className="px-3 py-3 font-medium"><T>Duration</T></th>
                      <th className="px-6 py-3 font-medium"><T>Tested</T></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-overlay/10">
                    {data.recent.map((item) => (
                      <tr
                        key={`${item.wingetId}-${item.testedVersion}-${item.architecture}`}
                        onClick={() => setSelected({ wingetId: item.wingetId, catalogVersion: item.catalogVersion })}
                        className="cursor-pointer transition-colors hover:bg-overlay/5"
                      >
                        <td className={cn('border-l-2 px-6 py-3', resultEdgeClass(item.outcome))}>
                          <button
                            type="button"
                            onClick={() => setSelected({ wingetId: item.wingetId, catalogVersion: item.catalogVersion })}
                            className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
                          >
                            <AppIcon packageId={item.wingetId} packageName={item.displayName} size="sm" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-text-primary">{item.displayName}</span>
                              <span className="block text-xs text-text-muted">{item.testedVersion} · {item.architecture}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <QaResultStatus outcome={item.outcome} />
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-text-secondary">{formatQaDuration(item.durationSeconds)}</td>
                        <td className="whitespace-nowrap px-6 py-3 text-xs text-text-muted">
                          {formatRelativeTime(item.testedAtUtc, data.serverTime) ?? <T>Not recorded</T>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="border-t border-overlay/10 px-6 py-8 text-sm text-text-muted"><T>No QA results have been published yet.</T></p>
          )}
        </section>
      </div>

      {selected ? (
        <QaDetailsDialog
          wingetId={selected.wingetId}
          catalogVersion={selected.catalogVersion}
          open={Boolean(selected)}
          onOpenChange={(open) => { if (!open) setSelected(null); }}
        />
      ) : null}
    </div>
  );
}

export function QaLiveClient() {
  return <QueryProvider><DashboardContent /></QueryProvider>;
}
