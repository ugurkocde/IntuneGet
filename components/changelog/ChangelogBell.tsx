'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BellRing } from 'lucide-react';
import { useGT } from 'gt-next';
import {
  CHANGELOG_SEEN_EVENT, CHANGELOG_SEEN_KEY, fetchProductChangelog,
  markChangelogSeen, readChangelogSeen, type ProductChangelogFeed,
} from '@/lib/product-changelog';

const ChangelogPanel = dynamic(() => import('./ChangelogPanel'), { ssr: false });

export function ChangelogBell({ onOpen }: { onOpen?: () => void }) {
  const t = useGT();
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<ProductChangelogFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const unread = Boolean(feed?.entries[0] && feed.entries[0].id !== seen);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const next = await fetchProductChangelog();
      if (mounted.current) setFeed(next);
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setSeen(readChangelogSeen());
    const syncSeen = (event: Event) => {
      if (event instanceof StorageEvent && event.key !== CHANGELOG_SEEN_KEY && event.key !== null) return;
      setSeen(event instanceof CustomEvent ? event.detail as string : readChangelogSeen());
    };
    // Defer the optional badge request until after critical page work. Hidden
    // tabs wait until visible; there is no background polling interval.
    const loadWhenVisible = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', loadWhenVisible);
      void load();
    };
    const timer = window.setTimeout(() => {
      if (document.hidden) document.addEventListener('visibilitychange', loadWhenVisible);
      else void load();
    }, 5000);
    window.addEventListener('storage', syncSeen);
    window.addEventListener(CHANGELOG_SEEN_EVENT, syncSeen);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', loadWhenVisible);
      window.removeEventListener('storage', syncSeen);
      window.removeEventListener(CHANGELOG_SEEN_EVENT, syncSeen);
    };
  }, [load]);

  const onRead = useCallback((id: string) => {
    setSeen(id);
    markChangelogSeen(id);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const returnFocus = useCallback(() => trigger.current?.focus(), []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        title={t("What's new in IntuneGet")}
        aria-label={unread ? t('Product updates, unread updates available') : t('Product updates')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onFocus={() => { void load(); }}
        onPointerEnter={() => { void load(); }}
        onClick={() => { onOpen?.(); setOpen(true); void load(); }}
        className="relative inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-overlay/5 hover:text-accent-cyan focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-elevated"
      >
        <BellRing className="h-5 w-5" aria-hidden="true" />
        {unread && <span data-unread="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent-cyan ring-2 ring-bg-elevated" aria-hidden="true" />}
      </button>
      {open && <ChangelogPanel id={panelId} feed={feed} loading={loading} error={error}
        onClose={close} onRetry={load} onRead={onRead} returnFocus={returnFocus} />}
    </>
  );
}
