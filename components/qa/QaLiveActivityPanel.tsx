'use client';

import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { T, Var } from 'gt-next';
import { ChevronLeft, ChevronRight, FileCode2, ListTree, Minus, Pencil, Plus, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QaLiveActivity, QaLiveActivityChange, QaLiveActivityKind, QaLiveLog, QaLivePhase } from '@/types/qa';

type Filter = 'all' | QaLiveActivityKind;
type MobileView = 'changes' | 'log';

const ITEMS_PER_PAGE = 6;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'file', label: 'Files' },
  { id: 'registry', label: 'Registry' },
];

const CHANGE_PRESENTATION: Record<QaLiveActivityChange, { label: string; className: string; Icon: typeof Plus }> = {
  added: { label: 'Added', className: 'bg-status-success/10 text-status-success', Icon: Plus },
  changed: { label: 'Updated', className: 'bg-status-warning/10 text-status-warning', Icon: Pencil },
  removed: { label: 'Removed', className: 'bg-status-error/10 text-status-error', Icon: Minus },
};

const KNOWN_OS_NOISE_TARGET_PREFIXES = [
  '%programdata%\\microsoft\\diagnosis\\aggregatorstorage',
];

function isKnownOsNoiseTarget(target: string): boolean {
  const normalizedTarget = target.trim().toLowerCase();
  return KNOWN_OS_NOISE_TARGET_PREFIXES.some(
    (prefix) => normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}\\`)
  );
}

function compactTarget(target: string): string {
  if (target.length <= 56) return target;
  const separator = target.lastIndexOf('\\');
  const leaf = separator >= 0 ? target.slice(separator + 1) : target.slice(-24);
  const prefixLength = Math.max(18, 52 - leaf.length);
  return `${target.slice(0, prefixLength)}…\\${leaf}`;
}

function ChangeBadge({ change }: { change: QaLiveActivityChange }) {
  const presentation = CHANGE_PRESENTATION[change];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium', presentation.className)}>
      <presentation.Icon className="h-3 w-3" aria-hidden="true" />
      <T>{presentation.label}</T>
    </span>
  );
}

function KindLabel({ kind }: { kind: QaLiveActivityKind }) {
  const Icon = kind === 'file' ? FileCode2 : ListTree;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      <Icon className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
      <T>{kind === 'file' ? 'File' : 'Registry'}</T>
    </span>
  );
}

function emptyMessage(phase: QaLivePhase): string {
  if (phase === 'installing') return 'Changes appear after installation completes and the clean and installed snapshots are compared.';
  if (phase === 'uninstalling') return 'The install comparison is complete. Uninstall changes appear after removal finishes.';
  if (phase === 'detecting_install' || phase === 'verifying_removal') return 'The VM is comparing trusted before-and-after snapshots.';
  return 'System-change evidence will appear when an installation snapshot is available.';
}

export const QaLiveActivityPanel = memo(function QaLiveActivityPanel({
  activity,
  log,
  phase,
  serverTime,
  mode = 'panel',
}: {
  activity: QaLiveActivity | null;
  log: QaLiveLog | null;
  phase: QaLivePhase;
  serverTime: string;
  mode?: 'panel' | 'dialog';
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [mobileView, setMobileView] = useState<MobileView>('changes');
  const fileCount = activity
    ? activity.counts.filesAdded + activity.counts.filesChanged + activity.counts.filesRemoved
    : 0;
  const registryCount = activity
    ? activity.counts.registryAdded + activity.counts.registryChanged + activity.counts.registryRemoved
    : 0;
  const filteredItems = useMemo(
    () => activity?.items.filter(
      (item) => !isKnownOsNoiseTarget(item.target) && (filter === 'all' || item.kind === filter)
    ) ?? [],
    [activity, filter]
  );
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedItems = filteredItems.slice(pageStart, pageStart + ITEMS_PER_PAGE);
  const filterCounts: Record<Filter, number> = {
    all: fileCount + registryCount,
    file: fileCount,
    registry: registryCount,
  };
  const detailsMissingFromSample = Boolean(
    activity && filterCounts[filter] > 0 && filteredItems.length === 0
  );
  const logAgeSeconds = log ? Math.max(0, Math.floor((new Date(serverTime).getTime() - new Date(log.lastWriteAt).getTime()) / 1000)) : null;
  const logAgeMinutes = logAgeSeconds == null ? null : Math.floor(logAgeSeconds / 60);
  const logLastEntryTime = log
    ? new Date(log.lastWriteAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  function moveFilter(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? FILTERS.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + FILTERS.length) % FILTERS.length;
    setFilter(FILTERS[nextIndex].id);
    setPage(1);
    document.getElementById(`qa-activity-tab-${FILTERS[nextIndex].id}`)?.focus();
  }

  function selectFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    setPage(1);
  }

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border border-overlay/10 bg-bg-surface/45',
        mode === 'dialog' ? 'min-h-[34rem]' : 'min-h-[22rem]'
      )}
      aria-labelledby="system-changes-heading"
    >
      <div className="border-b border-overlay/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="system-changes-heading" className="text-sm font-medium text-text-primary"><T>Detected system changes</T></h3>
            <p className="mt-1 text-xs text-text-muted">
              <T>{activity?.stage === 'during_install'
                ? 'Live installation activity'
                : activity?.stage === 'after_uninstall'
                  ? 'Removal comparison'
                  : activity
                    ? 'Installation comparison'
                    : 'Awaiting comparison'}</T>
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className={cn('h-1.5 w-1.5 rounded-full', activity ? 'bg-status-success' : 'animate-pulse bg-accent-cyan motion-reduce:animate-none')} aria-hidden="true" />
            <T>{activity ? 'Observed' : 'Collecting'}</T>
          </span>
        </div>
        <p className="sr-only" aria-live="polite">
          <T><Var>{fileCount}</Var> file changes and <Var>{registryCount}</Var> registry changes observed</T>
        </p>
        <div className="mt-3 hidden grid-cols-2 gap-2 sm:grid">
          <div className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-text-muted"><T>Files</T></p>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{fileCount}</p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-text-muted"><T>Registry</T></p>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{registryCount}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2 text-xs sm:hidden">
          <span className="text-text-secondary"><T><Var>{fileCount}</Var> files · <Var>{registryCount}</Var> registry</T></span>
          <span className="text-text-muted">
            <T>{activity?.stage === 'during_install' ? 'Live activity' : activity ? 'Snapshot ready' : 'Collecting'}</T>
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-lg border border-overlay/10 bg-overlay/[0.02] p-1 sm:hidden" role="group" aria-label="Live evidence view">
          {(['changes', 'log'] as const).map((view) => (
            <button
              key={view}
              type="button"
              aria-pressed={mobileView === view}
              onClick={() => setMobileView(view)}
              className={cn(
                'min-h-9 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
                mobileView === view ? 'bg-overlay/10 text-text-primary' : 'text-text-muted'
              )}
            >
              <T>{view === 'changes' ? 'Changes' : 'Log'}</T>
            </button>
          ))}
        </div>
      </div>

      <div className={cn('border-b border-overlay/10 bg-black/15 px-4 py-3', mobileView !== 'log' && 'hidden sm:block')}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            <ScrollText className="h-3.5 w-3.5 text-accent-cyan" aria-hidden="true" />
            <T>Live PSADT log</T>
          </span>
          <span className="text-[10px] text-text-muted">
            {logAgeMinutes != null && logAgeMinutes >= 1 ? (
              <T>No new entry for <Var>{logAgeMinutes}</Var>m</T>
            ) : logLastEntryTime ? (
              <T>Last entry <Var>{logLastEntryTime}</Var></T>
            ) : (
              <T>Waiting for output</T>
            )}
          </span>
        </div>
        {log?.lines.length ? (
          <ol className="max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] leading-relaxed text-text-muted" aria-label="Latest sanitized PSADT log entries">
            {log.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ol>
        ) : (
          <p className="text-xs text-text-muted"><T>Sanitized toolkit messages will appear while the installer is running.</T></p>
        )}
      </div>

      <div className={cn('border-b border-overlay/10 px-3 py-2', mobileView !== 'changes' && 'hidden sm:block')}>
        <div className="flex gap-1" role="tablist" aria-label="System change type">
          {FILTERS.map((item, index) => (
            <button
              id={`qa-activity-tab-${item.id}`}
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              aria-controls="qa-activity-panel"
              tabIndex={filter === item.id ? 0 : -1}
              onClick={() => selectFilter(item.id)}
              onKeyDown={(event) => moveFilter(event, index)}
              className={cn(
                'min-h-9 rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
                filter === item.id ? 'bg-overlay/10 text-text-primary' : 'text-text-muted hover:text-text-secondary'
              )}
            >
              <T>{item.label}</T> <span className="font-mono text-[10px]">{filterCounts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        id="qa-activity-panel"
        role="tabpanel"
        aria-labelledby={`qa-activity-tab-${filter}`}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto',
          paginatedItems.length > 0 && 'min-h-72 sm:min-h-88',
          mobileView !== 'changes' && 'hidden sm:block'
        )}
      >
        {paginatedItems.length ? (
          <>
            <div className="hidden sm:block">
              <table className="w-full table-fixed text-left">
                <caption className="sr-only"><T>Sanitized file and registry changes detected by snapshot comparison</T></caption>
                <thead className="sticky top-0 z-10 border-b border-overlay/10 bg-bg-elevated text-[11px] text-text-muted">
                  <tr>
                    <th scope="col" className="w-24 px-4 py-2 font-medium"><T>Kind</T></th>
                    <th scope="col" className="w-24 px-2 py-2 font-medium"><T>Change</T></th>
                    <th scope="col" className="px-2 py-2 pr-4 font-medium"><T>Target</T></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-overlay/10">
                  {paginatedItems.map((item) => (
                    <tr key={`${item.kind}|${item.change}|${item.target}`}>
                      <td className="px-4 py-2.5"><KindLabel kind={item.kind} /></td>
                      <td className="px-2 py-2.5"><ChangeBadge change={item.change} /></td>
                      <td className="px-2 py-2.5 pr-4">
                        <code
                          className={cn('block text-[11px] text-text-secondary', mode === 'dialog' ? 'break-all' : 'truncate')}
                          title={item.target}
                        >
                          {mode === 'dialog' ? item.target : compactTarget(item.target)}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-overlay/10 sm:hidden" aria-label="Detected system changes">
              {paginatedItems.map((item) => (
                <li key={`${item.kind}|${item.change}|${item.target}`} className="space-y-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-3"><KindLabel kind={item.kind} /><ChangeBadge change={item.change} /></div>
                  <code className="block break-all text-[11px] leading-relaxed text-text-secondary">{item.target}</code>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="flex h-full min-h-44 items-center justify-center px-6 py-8 text-center">
            <div>
              <ListTree className="mx-auto h-6 w-6 text-text-muted" aria-hidden="true" />
              <p className="mt-3 text-sm text-text-secondary">
                {detailsMissingFromSample ? (
                  <T><Var>{filterCounts[filter]}</Var> changes were counted, but their detailed paths were not included in this run&apos;s evidence sample.</T>
                ) : (
                  <T>{activity ? 'No changes in this category were detected.' : emptyMessage(phase)}</T>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {filteredItems.length > ITEMS_PER_PAGE ? (
        <nav className={cn('items-center justify-between gap-3 border-t border-overlay/10 px-3 py-2.5 sm:flex', mobileView === 'changes' ? 'flex' : 'hidden')} aria-label="System changes pagination">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-overlay/10 px-2.5 text-xs text-text-secondary transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <T>Previous</T>
          </button>
          <span className="text-center text-[11px] text-text-muted" aria-live="polite">
            <T>Page <Var>{currentPage}</Var> of <Var>{pageCount}</Var></T>
            <span className="hidden sm:inline"> · {pageStart + 1}–{Math.min(pageStart + ITEMS_PER_PAGE, filteredItems.length)} of {filteredItems.length}</span>
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
            disabled={currentPage === pageCount}
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-overlay/10 px-2.5 text-xs text-text-secondary transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <T>Next</T>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </nav>
      ) : null}

      <p className={cn('border-t border-overlay/10 px-4 py-2.5 text-[11px] leading-relaxed text-text-muted sm:block', mobileView !== 'changes' && 'hidden')}>
        {activity ? <T>Compared at <Var>{new Date(activity.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Var>. </T> : null}
        {activity?.truncated ? (
          <T>Snapshot comparison, not a complete real-time trace. Paths are sanitized and a 40-entry sample is shown.</T>
        ) : (
          <T>Snapshot comparison, not a complete real-time trace. Paths are sanitized and up to 40 entries are shown.</T>
        )}
      </p>
    </section>
  );
});
