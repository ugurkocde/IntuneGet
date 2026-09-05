'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { BellRing, ExternalLink, RefreshCw, X } from 'lucide-react';
import { T, useGT, useLocale } from 'gt-next';
import { CHANGELOG_ARCHIVE_URL, changelogEntryUrl, type ProductChangelogFeed } from '@/lib/product-changelog';

interface ChangelogPanelProps {
  id: string;
  feed: ProductChangelogFeed | null;
  loading: boolean;
  error: boolean;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onRead: (id: string) => void;
  returnFocus: () => void;
}

export default function ChangelogPanel({ id, feed, loading, error, onClose, onRetry, onRead, returnFocus }: ChangelogPanelProps) {
  const t = useGT();
  const locale = useLocale();
  const closeButton = useRef<HTMLButtonElement>(null);
  const formatDate = useMemo(() => new Intl.DateTimeFormat(locale || 'en', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }), [locale]);
  const latestId = feed?.entries[0]?.id;
  useEffect(() => { if (latestId) onRead(latestId); }, [latestId, onRead]);

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content
          id={id}
          onOpenAutoFocus={(event) => { event.preventDefault(); closeButton.current?.focus(); }}
          onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(); }}
          className="fixed inset-0 z-[80] flex h-dvh w-full flex-col overflow-hidden bg-bg-elevated text-text-primary shadow-soft-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan sm:inset-auto sm:bottom-4 sm:right-4 sm:top-4 sm:h-[calc(100dvh-2rem)] sm:w-[28rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl sm:border sm:border-overlay/10"
        >
          <header className="shrink-0 border-b border-overlay/10 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-cyan/15 bg-accent-cyan/10 text-accent-cyan">
                  <BellRing className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <Dialog.Title className="text-xl font-semibold tracking-tight"><T>What&apos;s new</T></Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm leading-5 text-text-secondary"><T>News and improvements from IntuneGet.</T></Dialog.Description>
                </div>
              </div>
              <Dialog.Close ref={closeButton} aria-label={t('Close product updates')}
                className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-overlay/5 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                <X className="h-5 w-5" aria-hidden="true" />
              </Dialog.Close>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6">
            {loading && !feed && !error && (
              <div role="status" aria-label={t('Loading product updates')}>
                <span className="sr-only"><T>Loading updates…</T></span>
                <div className="space-y-8" aria-hidden="true">
                  {[0, 1, 2].map(item => <div key={item} className="animate-pulse space-y-3 motion-reduce:animate-none">
                    <div className="h-3 w-24 rounded bg-overlay/10" />
                    <div className="h-5 w-4/5 rounded bg-overlay/10" />
                    <div className="h-3 w-full rounded bg-overlay/5" />
                    <div className="h-3 w-2/3 rounded bg-overlay/5" />
                  </div>)}
                </div>
              </div>
            )}
            {error && <div role="status" className="mb-6 rounded-xl border border-overlay/10 bg-bg-surface p-5">
              <p className="font-medium"><T>Updates are temporarily unavailable</T></p>
              <p className="mt-2 text-sm leading-6 text-text-secondary"><T>Please try again in a moment.</T></p>
              <button type="button" disabled={loading} onClick={() => { void onRetry(); }}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-overlay/10 px-4 text-sm font-medium text-text-primary transition-colors hover:bg-overlay/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan disabled:opacity-50">
                <RefreshCw className="h-4 w-4" aria-hidden="true" /><T>Try again</T>
              </button>
            </div>}
            {feed?.entries.length === 0 && <div className="rounded-xl border border-dashed border-overlay/15 px-5 py-10 text-center">
              <p className="font-medium"><T>No updates published yet</T></p>
              <p className="mt-2 text-sm leading-6 text-text-secondary"><T>Product news and improvements will appear here as they ship.</T></p>
            </div>}
            {Boolean(feed?.entries.length) && <ol className="space-y-6">
              {feed!.entries.map(entry => <li key={entry.id} className="border-b border-overlay/10 pb-6 last:border-0 last:pb-0">
                <article>
                  <time dateTime={entry.publishedOn} className="text-xs font-medium tabular-nums text-text-muted">{formatDate.format(new Date(`${entry.publishedOn}T00:00:00Z`))}</time>
                  <h3 className="mt-2 break-words text-base font-semibold leading-6">{entry.title}</h3>
                  <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-text-secondary">{entry.summary}</p>
                  <a href={changelogEntryUrl(entry.id)} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-accent-cyan transition-colors hover:text-accent-cyan-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
                    <T>Read update</T><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </article>
              </li>)}
            </ol>}
          </div>

          <footer className="shrink-0 border-t border-overlay/10 bg-bg-surface px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
            <a href={CHANGELOG_ARCHIVE_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent-cyan px-4 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-accent-cyan-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-surface">
              <T>View all IntuneGet updates</T><ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
