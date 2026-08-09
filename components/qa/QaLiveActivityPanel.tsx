'use client';

import { memo, useMemo, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, FileCode2, ListTree, Minus, Pencil, Plus, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QaLiveActivity, QaLiveActivityChange, QaLiveActivityKind, QaLiveLog, QaLivePhase } from '@/types/qa';

type Filter = 'all' | QaLiveActivityKind;

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
      {presentation.label}
    </span>
  );
}

function KindLabel({ kind }: { kind: QaLiveActivityKind }) {
  const Icon = kind === 'file' ? FileCode2 : ListTree;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
      <Icon className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
      {kind === 'file' ? 'File' : 'Registry'}
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
}: {
  activity: QaLiveActivity | null;
  log: QaLiveLog | null;
  phase: QaLivePhase;
  serverTime: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
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
  const logAgeSeconds = log ? Math.max(0, Math.floor((new Date(serverTime).getTime() - new Date(log.lastWriteAt).getTime()) / 1000)) : null;
  const logStatus = logAgeSeconds != null && logAgeSeconds >= 60
    ? `No new entry for ${Math.floor(logAgeSeconds / 60)}m`
    : log
      ? `Last entry ${new Date(log.lastWriteAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'Waiting for output';

  function moveFilter(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + offset + FILTERS.length) % FILTERS.length;
    setFilter(FILTERS[nextIndex].id);
    setPage(1);
    document.getElementById(`qa-activity-tab-${FILTERS[nextIndex].id}`)?.focus();
  }

  function selectFilter(nextFilter: Filter) {
    setFilter(nextFilter);
    setPage(1);
  }

  return (
    <section className="flex min-h-[24rem] flex-col overflow-hidden rounded-xl border border-overlay/10 bg-bg-primary/45 lg:max-h-[32rem]" aria-labelledby="system-changes-heading">
      <div className="border-b border-overlay/10 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="system-changes-heading" className="text-sm font-medium text-text-primary">Detected system changes</h3>
            <p className="mt-1 text-xs text-text-muted">
              {activity?.stage === 'during_install'
                ? 'Live installation activity'
                : activity?.stage === 'after_uninstall'
                  ? 'Removal comparison'
                  : activity
                    ? 'Installation comparison'
                    : 'Awaiting comparison'}
            </p>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className={cn('h-1.5 w-1.5 rounded-full', activity ? 'bg-status-success' : 'animate-pulse bg-accent-cyan')} aria-hidden="true" />
            {activity ? 'Observed' : 'Collecting'}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2" aria-live="polite" aria-atomic="true">
          <div className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Files</p>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{fileCount}</p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-overlay/[0.03] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-text-muted">Registry</p>
            <p className="mt-0.5 font-mono text-lg font-semibold text-text-primary">{registryCount}</p>
          </div>
        </div>
      </div>

      <div className="border-b border-overlay/10 bg-black/15 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            <ScrollText className="h-3.5 w-3.5 text-accent-cyan" aria-hidden="true" />
            Live PSADT log
          </span>
          <span className="text-[10px] text-text-muted">
            {logStatus}
          </span>
        </div>
        {log?.lines.length ? (
          <ol className="max-h-28 space-y-1 overflow-y-auto font-mono text-[10px] leading-relaxed text-text-muted" aria-label="Latest sanitized PSADT log entries">
            {log.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ol>
        ) : (
          <p className="text-xs text-text-muted">Sanitized toolkit messages will appear while the installer is running.</p>
        )}
      </div>

      <div className="border-b border-overlay/10 px-3 py-2">
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
                'rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan',
                filter === item.id ? 'bg-overlay/10 text-text-primary' : 'text-text-muted hover:text-text-secondary'
              )}
            >
              {item.label} <span className="font-mono text-[10px]">{filterCounts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div id="qa-activity-panel" role="tabpanel" aria-labelledby={`qa-activity-tab-${filter}`} className="min-h-0 flex-1 overflow-y-auto">
        {paginatedItems.length ? (
          <>
            <div className="hidden sm:block">
              <table className="w-full table-fixed text-left">
                <caption className="sr-only">Sanitized file and registry changes detected by snapshot comparison</caption>
                <thead className="sticky top-0 z-10 border-b border-overlay/10 bg-bg-elevated text-[11px] text-text-muted">
                  <tr>
                    <th scope="col" className="w-24 px-4 py-2 font-medium">Kind</th>
                    <th scope="col" className="w-24 px-2 py-2 font-medium">Change</th>
                    <th scope="col" className="px-2 py-2 pr-4 font-medium">Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-overlay/10">
                  {paginatedItems.map((item) => (
                    <tr key={`${item.kind}|${item.change}|${item.target}`}>
                      <td className="px-4 py-2.5"><KindLabel kind={item.kind} /></td>
                      <td className="px-2 py-2.5"><ChangeBadge change={item.change} /></td>
                      <td className="px-2 py-2.5 pr-4"><code className="block truncate text-[11px] text-text-secondary" title={item.target}>{compactTarget(item.target)}</code></td>
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
              <p className="mt-3 text-sm text-text-secondary">{activity ? 'No changes in this category were detected.' : emptyMessage(phase)}</p>
            </div>
          </div>
        )}
      </div>

      {filteredItems.length > ITEMS_PER_PAGE ? (
        <nav className="flex items-center justify-between gap-3 border-t border-overlay/10 px-3 py-2.5" aria-label="System changes pagination">
          <button
            type="button"
            onClick={() => setPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-overlay/10 px-2.5 text-xs text-text-secondary transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Previous
          </button>
          <span className="text-center text-[11px] text-text-muted" aria-live="polite">
            Page {currentPage} of {pageCount}
            <span className="hidden sm:inline"> · {pageStart + 1}–{Math.min(pageStart + ITEMS_PER_PAGE, filteredItems.length)} of {filteredItems.length}</span>
          </span>
          <button
            type="button"
            onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
            disabled={currentPage === pageCount}
            className="inline-flex min-h-9 items-center gap-1 rounded-md border border-overlay/10 px-2.5 text-xs text-text-secondary transition-colors hover:bg-overlay/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </nav>
      ) : null}

      <p className="border-t border-overlay/10 px-4 py-2.5 text-[11px] leading-relaxed text-text-muted">
        {activity ? `Compared at ${new Date(activity.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. ` : ''}
        Snapshot comparison, not a complete real-time trace. Paths are sanitized and {activity?.truncated ? 'the first 40 entries are shown.' : 'up to 40 entries are shown.'}
      </p>
    </section>
  );
});
