'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Server, ShieldCheck, XCircle } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { QaDetailsDialog } from '@/components/qa/QaDetailsDialog';
import { QaPhaseTimeline } from '@/components/qa/QaPhaseTimeline';
import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import { useElapsedTime } from '@/hooks/use-elapsed-time';
import { useQaLive } from '@/hooks/use-qa';
import type { QaLiveResponse } from '@/types/qa';

function relativeTime(value: string | null): string {
  if (!value) return 'No data yet';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function duration(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function healthTone(state: string): StatusTone {
  if (state === 'healthy' || state === 'testing') return 'success';
  if (state === 'degraded' || state === 'stalled') return 'error';
  return 'neutral';
}

function CurrentTest({ data }: { data: QaLiveResponse }) {
  const correctedStart = useMemo(
    () => data.current
      ? new Date(Date.now() - data.current.elapsedSeconds * 1000).toISOString()
      : null,
    [data.current]
  );
  const elapsed = useElapsedTime({ startTime: correctedStart });

  if (!data.current) {
    return (
      <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6" aria-labelledby="current-test-heading">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-status-success/10 p-3 text-status-success">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 id="current-test-heading" className="text-lg font-semibold text-text-primary">Runner is ready</h2>
            <p className="text-sm text-text-secondary">
              {data.queue.count > 0 ? 'Waiting for the next dispatch check.' : 'No application is waiting to be tested.'}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 rounded-2xl border border-accent-cyan/20 bg-bg-elevated p-6 shadow-glow-cyan" aria-labelledby="current-test-heading">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <AppIcon packageId={data.current.wingetId} packageName={data.current.displayName} size="xl" />
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <StatusBadge tone={data.runner.state === 'stalled' ? 'error' : 'accent'} icon={data.runner.state === 'stalled' ? AlertTriangle : Loader2}>
                {data.runner.state === 'stalled' ? 'Needs attention' : 'Testing now'}
              </StatusBadge>
              <span className="text-xs text-text-muted">{data.current.executionContext}</span>
            </div>
            <h2 id="current-test-heading" className="truncate text-xl font-semibold text-text-primary">{data.current.displayName}</h2>
            <p className="truncate text-sm text-text-muted">{data.current.wingetId}</p>
          </div>
        </div>
        <div className="flex items-center gap-5 sm:text-right">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">Version</p>
            <p className="font-mono text-sm text-text-primary">{data.current.version} · {data.current.architecture}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted">Elapsed</p>
            <p className="font-mono text-lg font-semibold text-accent-cyan">{elapsed.formattedTime}</p>
          </div>
        </div>
      </div>
      <QaPhaseTimeline currentPhase={data.current.phase} />
    </section>
  );
}

function DashboardContent() {
  const { data, isLoading, isError, refetch } = useQaLive();
  const [selected, setSelected] = useState<{ wingetId: string; catalogVersion: string } | null>(null);

  if (isLoading) {
    return <div className="h-80 animate-pulse rounded-2xl border border-overlay/10 bg-bg-elevated" aria-label="Loading live QA status" />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-2xl border border-status-error/20 bg-status-error/5 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-status-error" aria-hidden="true" />
        <p className="font-medium text-text-primary">Live QA status is temporarily unavailable.</p>
        <button type="button" onClick={() => refetch()} className="mt-3 rounded-lg border border-overlay/10 px-4 py-2 text-sm text-text-secondary hover:text-text-primary">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-overlay/10 bg-bg-elevated p-5">
          <div className="mb-3 flex items-center justify-between"><span className="text-sm text-text-muted">QA runner</span><Server className="h-4 w-4 text-text-muted" aria-hidden="true" /></div>
          <StatusBadge tone={healthTone(data.runner.state)}>{data.runner.state === 'testing' ? 'Testing' : data.runner.state === 'stalled' ? 'Stalled' : 'Idle'}</StatusBadge>
          <p className="mt-2 text-xs text-text-muted">
            {data.runner.heartbeatAt
              ? `Heartbeat ${relativeTime(data.runner.heartbeatAt)}`
              : data.queue.count > 0
                ? 'Next dispatch check within one minute'
                : 'No active test'}
          </p>
        </div>
        <div className="rounded-2xl border border-overlay/10 bg-bg-elevated p-5">
          <div className="mb-3 flex items-center justify-between"><span className="text-sm text-text-muted">WinGet polling</span><Clock3 className="h-4 w-4 text-text-muted" aria-hidden="true" /></div>
          <StatusBadge tone={healthTone(data.scheduler.state)}>{data.scheduler.state.charAt(0).toUpperCase() + data.scheduler.state.slice(1)}</StatusBadge>
          <p className="mt-2 text-xs text-text-muted">Last scan {relativeTime(data.scheduler.lastPollAt)}</p>
        </div>
        <div className="rounded-2xl border border-overlay/10 bg-bg-elevated p-5">
          <div className="mb-3 flex items-center justify-between"><span className="text-sm text-text-muted">Queue</span><Loader2 className="h-4 w-4 text-text-muted" aria-hidden="true" /></div>
          <p className="text-2xl font-semibold tabular-nums text-text-primary">{data.queue.count}</p>
          <p className="mt-1 text-xs text-text-muted">applications waiting</p>
        </div>
      </div>

      <CurrentTest data={data} />

      <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6" aria-labelledby="queue-heading">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id="queue-heading" className="text-lg font-semibold text-text-primary">Next in queue</h2>
            <span className="text-xs text-text-muted">Single-flight testing</span>
          </div>
          {data.queue.next.length ? (
            <ol className="divide-y divide-overlay/10">
              {data.queue.next.map((item, index) => (
                <li key={`${item.wingetId}-${item.version}-${item.architecture}`} className="flex items-center gap-3 py-3">
                  <span className="w-5 text-xs tabular-nums text-text-muted">{index + 1}</span>
                  <AppIcon packageId={item.wingetId} packageName={item.displayName} size="sm" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-text-primary">{item.displayName}</p><p className="truncate text-xs text-text-muted">{item.version} · {item.architecture}</p></div>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-text-muted">The queue is clear.</p>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated" aria-labelledby="recent-heading">
          <div className="flex items-baseline justify-between px-6 py-5">
            <h2 id="recent-heading" className="text-lg font-semibold text-text-primary">Recent results</h2>
            <span className="text-xs text-text-muted">Select a result for evidence</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-overlay/10 text-xs text-text-muted"><tr><th className="px-6 py-3 font-medium">Application</th><th className="px-3 py-3 font-medium">Result</th><th className="px-3 py-3 font-medium">Duration</th><th className="px-6 py-3 font-medium">Tested</th></tr></thead>
              <tbody className="divide-y divide-overlay/10">
                {data.recent.map((item) => (
                  <tr key={item.wingetId}>
                    <td className="px-6 py-3"><button type="button" onClick={() => setSelected({ wingetId: item.wingetId, catalogVersion: item.catalogVersion })} className="text-left hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"><span className="block font-medium text-text-primary">{item.displayName}</span><span className="text-xs text-text-muted">{item.testedVersion} · {item.architecture}</span></button></td>
                    <td className="px-3 py-3"><StatusBadge tone={item.outcome === 'Passed' ? 'success' : 'error'} icon={item.outcome === 'Passed' ? CheckCircle2 : XCircle}>{item.outcome}</StatusBadge></td>
                    <td className="px-3 py-3 font-mono text-xs text-text-secondary">{duration(item.durationSeconds)}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-xs text-text-muted">{relativeTime(item.testedAtUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selected ? <QaDetailsDialog wingetId={selected.wingetId} catalogVersion={selected.catalogVersion} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }} /> : null}
    </div>
  );
}

export function QaLiveClient() {
  return <QueryProvider><DashboardContent /></QueryProvider>;
}
