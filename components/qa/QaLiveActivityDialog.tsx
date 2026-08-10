'use client';

import { ChevronRight, FileCode2, ListTree, ScrollText } from 'lucide-react';
import { T, Var } from 'gt-next';
import { QaLiveActivityPanel } from '@/components/qa/QaLiveActivityPanel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { QaLiveActivity, QaLiveLog, QaLivePhase } from '@/types/qa';

export function QaLiveActivityDialog({
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
  const fileCount = activity
    ? activity.counts.filesAdded + activity.counts.filesChanged + activity.counts.filesRemoved
    : 0;
  const registryCount = activity
    ? activity.counts.registryAdded + activity.counts.registryChanged + activity.counts.registryRemoved
    : 0;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group flex min-h-16 w-full flex-col gap-3 rounded-xl border border-overlay/10 bg-bg-surface/45 px-4 py-3 text-left transition-all hover:border-accent-cyan/25 hover:bg-overlay/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="rounded-lg bg-accent-cyan/10 p-2 text-accent-cyan" aria-hidden="true">
              <ListTree className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-text-primary"><T>Detected system changes</T></span>
              <span className="mt-0.5 block text-xs text-text-muted">
                <T>Open live files, registry activity, and the sanitized PSADT log</T>
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2 sm:shrink-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-overlay/[0.06] px-2.5 py-1 text-xs text-text-secondary">
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
              <T><Var>{fileCount}</Var> files</T>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-overlay/[0.06] px-2.5 py-1 text-xs text-text-secondary">
              <ListTree className="h-3.5 w-3.5" aria-hidden="true" />
              <T><Var>{registryCount}</Var> registry</T>
            </span>
            {log?.lines.length ? (
              <span className="hidden rounded-full bg-status-success/10 p-1.5 text-status-success sm:inline-flex" title="Live PSADT log available">
                <ScrollText className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ) : null}
            <ChevronRight className="h-4 w-4 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-[calc(100%_-_1.5rem)] max-w-6xl flex-col">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle><T>Live installation evidence</T></DialogTitle>
          <DialogDescription>
            <T>Sanitized snapshot changes and PSADT activity from the isolated test VM.</T>
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <QaLiveActivityPanel
            activity={activity}
            log={log}
            phase={phase}
            serverTime={serverTime}
            mode="dialog"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
