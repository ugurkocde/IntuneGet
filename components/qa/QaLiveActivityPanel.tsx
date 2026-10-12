'use client';

import { memo, useMemo, useState } from 'react';
import { T, Var } from 'gt-next';
import { ChevronLeft, ChevronRight, FileCode2, ListTree, Minus, Pencil, Plus, ScrollText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { evidenceTargetName } from '@/lib/qa/evidence-presentation';
import { cn } from '@/lib/utils';
import type { QaLiveActivity, QaLiveActivityChange, QaLiveActivityKind, QaLiveLog, QaLivePhase } from '@/types/qa';

type Filter = 'all' | QaLiveActivityKind;
const ITEMS_PER_PAGE = 6;
const FILTERS: Array<{ id: Filter; label: string }> = [{ id: 'all', label: 'All changes' }, { id: 'file', label: 'Files' }, { id: 'registry', label: 'Registry' }];
const CHANGE_PRESENTATION: Record<QaLiveActivityChange, { label: string; className: string; Icon: typeof Plus }> = {
  added: { label: 'Added', className: 'text-status-success', Icon: Plus },
  changed: { label: 'Updated', className: 'text-status-warning', Icon: Pencil },
  removed: { label: 'Removed', className: 'text-text-secondary', Icon: Minus },
};
const PAGE_BUTTON = 'inline-flex min-h-10 items-center gap-1 rounded-lg border border-overlay/10 px-3 text-sm text-text-secondary hover:bg-overlay/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan disabled:opacity-40';

function isKnownOsNoiseTarget(target: string): boolean {
  const normalized = target.trim().toLowerCase();
  const prefix = '%programdata%\\microsoft\\diagnosis\\aggregatorstorage';
  return normalized === prefix || normalized.startsWith(`${prefix}\\`);
}

function emptyMessage(phase: QaLivePhase): string {
  if (phase === 'installing') return 'Collecting installation activity. File and registry samples will appear as evidence becomes available.';
  if (phase === 'uninstalling') return 'Removal changes will appear when the uninstall comparison is available.';
  return 'File and registry changes will appear when the VM publishes its next comparison.';
}

export const QaLiveActivityPanel = memo(function QaLiveActivityPanel({ activity, log, phase, serverTime }: {
  activity: QaLiveActivity | null;
  log: QaLiveLog | null;
  phase: QaLivePhase;
  serverTime: string;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const fileCount = activity ? activity.counts.filesAdded + activity.counts.filesChanged + activity.counts.filesRemoved : 0;
  const registryCount = activity ? activity.counts.registryAdded + activity.counts.registryChanged + activity.counts.registryRemoved : 0;
  const counts: Record<Filter, number> = { all: fileCount + registryCount, file: fileCount, registry: registryCount };
  const items = useMemo(() => activity?.items.filter((item) => !isKnownOsNoiseTarget(item.target) && (filter === 'all' || item.kind === filter)) ?? [], [activity, filter]);
  const pageCount = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * ITEMS_PER_PAGE;
  const logAgeMinutes = log ? Math.max(0, Math.floor((Date.parse(serverTime) - Date.parse(log.lastWriteAt)) / 60000)) : null;

  return (
    <Tabs defaultValue="changes" className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-overlay/10 px-5 py-3 sm:px-6">
        <TabsList className="grid w-full grid-cols-2 sm:w-fit" aria-label="Live test evidence">
          <TabsTrigger value="changes" className="min-h-9 gap-2"><ListTree className="h-4 w-4" aria-hidden="true" /><T>Changes</T></TabsTrigger>
          <TabsTrigger value="log" className="min-h-9 gap-2"><ScrollText className="h-4 w-4" aria-hidden="true" /><T>Log</T></TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="changes" className="m-0 min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="mb-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary"><T>{activity?.stage === 'during_install' ? 'During installation' : activity?.stage === 'after_uninstall' ? 'After uninstall' : activity ? 'After installation' : 'Collecting changes'}</T></h3>
            {activity ? <span className="text-xs text-text-muted"><T>Updated <Var>{new Date(activity.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Var></T></span> : null}
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter system changes">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => { setFilter(item.id); setPage(1); }}
                className={cn('min-h-10 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan', filter === item.id ? 'border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan' : 'border-overlay/10 text-text-secondary hover:bg-overlay/5')}>
                <T>{item.label}</T><span className="ml-2 tabular-nums">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <p className="text-xs leading-5 text-text-muted"><T><Var>{items.length}</Var> sampled paths available · <Var>{counts[filter]}</Var> changes observed in this category.</T>{' '}<T>Counts cover the test window and may include background Windows activity.</T></p>
        </div>
        {items.length ? (
          <ul className="divide-y divide-overlay/10 rounded-xl border border-overlay/10">
            {items.slice(pageStart, pageStart + ITEMS_PER_PAGE).map((item) => {
              const KindIcon = item.kind === 'file' ? FileCode2 : ListTree;
              const change = CHANGE_PRESENTATION[item.change];
              return (
                <li key={`${item.kind}|${item.change}|${item.target}`}>
                  <details className="group">
                    <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-overlay/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan [&::-webkit-details-marker]:hidden">
                      <KindIcon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium text-text-primary [overflow-wrap:anywhere]">{evidenceTargetName(item.target)}</span><span className="mt-0.5 block text-xs text-text-muted"><T>{item.kind === 'file' ? 'File or directory' : 'Registry entry'}</T></span></span>
                      <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', change.className)}><change.Icon className="h-3.5 w-3.5" aria-hidden="true" /><T>{change.label}</T></span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                      <span className="sr-only"><T>Show full sanitized path</T></span>
                    </summary>
                    <div className="border-t border-overlay/5 bg-bg-elevated/40 px-4 py-3"><p className="mb-1 text-xs text-text-muted"><T>Full sanitized path</T></p><code className="select-text break-all text-xs leading-6 text-text-secondary">{item.target}</code></div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-overlay/15 px-6 text-center">
            <ListTree className="mb-3 h-7 w-7 text-text-muted" aria-hidden="true" />
            <p className="max-w-md text-sm leading-6 text-text-secondary"><T>{counts[filter] > 0 ? 'Changes were counted, but paths for this category were not included in the evidence sample.' : activity ? 'No changes were observed in this category.' : emptyMessage(phase)}</T></p>
          </div>
        )}
        {pageCount > 1 ? (
          <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Sampled changes pagination">
            <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} className={PAGE_BUTTON}><ChevronLeft className="h-4 w-4" aria-hidden="true" /><T>Previous</T></button>
            <span className="text-xs text-text-muted" aria-live="polite"><T><Var>{pageStart + 1}</Var>–<Var>{Math.min(pageStart + ITEMS_PER_PAGE, items.length)}</Var> of <Var>{items.length}</Var> paths</T></span>
            <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} className={PAGE_BUTTON}><T>Next</T><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
          </nav>
        ) : null}
        <p className="mt-5 text-xs leading-5 text-text-muted"><T>Paths are sanitized. This is a sample of observed activity, not a complete real-time trace.</T></p>
      </TabsContent>
      <TabsContent value="log" className="m-0 min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-text-primary"><T>PSADT log</T></h3><span className="text-xs text-text-muted">{logAgeMinutes !== null && logAgeMinutes >= 1 ? <T>No new entry for <Var>{logAgeMinutes}</Var>m</T> : log ? <T>Last entry <Var>{new Date(log.lastWriteAt).toLocaleTimeString()}</Var></T> : <T>Waiting for output</T>}</span></div>
        {log?.lines.length ? <ol className="space-y-2 rounded-xl border border-overlay/10 bg-bg-elevated/50 p-4 font-mono text-xs leading-6 text-text-secondary" aria-label="Latest sanitized PSADT log entries">{log.lines.map((line, index) => <li key={`${index}-${line}`} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{line}</li>)}</ol> : <p className="rounded-xl border border-dashed border-overlay/15 p-6 text-sm leading-6 text-text-muted"><T>Toolkit messages will appear here when PSADT publishes output.</T></p>}
        <p className="mt-4 text-xs text-text-muted"><T>Latest sanitized entries from this test. Earlier log entries may not be included.</T></p>
      </TabsContent>
    </Tabs>
  );
});
