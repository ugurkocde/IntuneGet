'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Maximize2, Minimize2, Monitor } from 'lucide-react';
import { T } from 'gt-next';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { QaFrameState } from '@/lib/qa/presentation';
import styles from './QaDialog.module.css';

const CONTROL_CLASS = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-black/70 text-white shadow-sm transition-colors hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan';

export function QaVmViewer({ src, appName, phaseLabel, frameState }: {
  src: string | null;
  appName: string;
  phaseLabel: string;
  frameState: QaFrameState;
}) {
  const [expanded, setExpanded] = useState(false);
  const [visibleSrc, setVisibleSrc] = useState<string | null>(null);
  const alt = `Read-only live view of the isolated QA VM while testing ${appName}`;

  // Both surfaces retain their image through the dialog's entrance and exit.
  // A single persistent loader swaps frames only after decoding.
  const frame = (
    <>
      {src && visibleSrc ? <Image src={visibleSrc} alt={alt} fill unoptimized loading="eager" className="object-contain" /> : null}
      {!src || !visibleSrc ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Monitor className="h-8 w-8 text-white/30" aria-hidden="true" />
          <p className="max-w-md text-sm text-white/60"><T>{src ? 'Loading the live VM view…' : 'Waiting for the next VM frame.'}</T></p>
        </div>
      ) : null}
      {frameState === 'live' ? (
        <span className="absolute right-4 top-4 z-10 animate-pulse text-xs font-semibold uppercase tracking-[0.16em] text-status-success drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] motion-reduce:animate-none"><T>Live</T></span>
      ) : frameState === 'paused' ? (
        <span className="absolute right-4 top-4 z-10 rounded-md bg-black/70 px-2 py-1 text-xs text-white/80"><T>Waiting for updates</T></span>
      ) : null}
    </>
  );

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <div className="absolute inset-0 overflow-hidden rounded-[inherit] bg-black">
        {frame}
        {src && src !== visibleSrc ? (
          <Image key={src} src={src} alt="" aria-hidden="true" fill unoptimized loading="eager" fetchPriority="high" className="pointer-events-none object-contain opacity-0" onLoad={() => setVisibleSrc(src)} />
        ) : null}
        <DialogTrigger asChild>
          <button type="button" className={`absolute left-3 top-3 z-20 ${CONTROL_CLASS}`} title="Expand VM view" aria-label="Expand VM view">
            <Maximize2 className="h-5 w-5" aria-hidden="true" /><span className="sr-only"><T>Expand VM view</T></span>
          </button>
        </DialogTrigger>
      </div>
      <DialogContent hideCloseButton overlayClassName={styles.overlay} className={`${styles.dialog} w-[min(96vw,calc((92dvh_-_5rem)_*_16_/_9))] max-w-[1920px] bg-bg-surface`}>
        <div className="flex h-20 items-center justify-between gap-4 px-4 sm:px-5">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{appName}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs"><T>{phaseLabel}</T> · <T>Read-only VM view</T></DialogDescription>
          </div>
          <DialogClose asChild>
            <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-overlay/15 text-text-primary hover:bg-overlay/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan" title="Return to page" aria-label="Return to page">
              <Minimize2 className="h-5 w-5" aria-hidden="true" /><span className="sr-only"><T>Return to page</T></span>
            </button>
          </DialogClose>
        </div>
        <div className="relative aspect-video w-full overflow-hidden bg-black">{frame}</div>
      </DialogContent>
    </Dialog>
  );
}
