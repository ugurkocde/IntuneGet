'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, ExternalLink, Loader2, Package, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { T } from 'gt-next';
import { useCartStore } from '@/stores/cart-store';
import type { CuratedAppDefinition } from '@/lib/curated-catalog/types';
import type { Win32CartItem } from '@/types/upload';

interface CatalogResponse {
  expiresAt: string | null;
  entries: Array<{
    app: Pick<CuratedAppDefinition, 'id' | 'name' | 'publisher' | 'channel' | 'category' | 'homepage' | 'architecture' | 'scope' | 'locale' | 'autoUpdate'>;
    status: 'pending' | 'approved' | 'withdrawn';
    release: { id: string; version: string; approvedAt: string; installerSha256: string; sourceUrl: string; testedAt: string; testReportUrl: string; securityReportUrl: string; signatureStatus: string } | null;
    cartItem: Omit<Win32CartItem, 'id' | 'addedAt'> | null;
  }>;
}

export function CuratedCatalog() {
  const [query, setQuery] = useState('');
  const addItem = useCartStore(state => state.addItem);
  const items = useCartStore(state => state.items);
  const { data, isPending, error, refetch, isFetching } = useQuery<CatalogResponse>({
    queryKey: ['curated-catalog'],
    queryFn: async () => {
      const response = await fetch('/api/curated-catalog', { cache: 'no-store' });
      if (!response.ok) throw new Error('The curated catalog is temporarily unavailable.');
      return response.json();
    },
    staleTime: 30_000, refetchInterval: 60_000,
  });
  const visible = data?.entries.filter(({ app }) => `${app.name} ${app.publisher} ${app.channel}`.toLowerCase().includes(query.toLowerCase())) || [];
  const approvedCount = data?.entries.filter(entry => entry.status === 'approved').length || 0;
  const expired = Boolean(data?.expiresAt && Date.parse(data.expiresAt) <= Date.now());

  return (
    <div className="space-y-6 pb-8">
      <Link href="/dashboard/apps" className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" /><T>All application sources</T>
      </Link>
      <section className="rounded-2xl border border-overlay/10 bg-bg-elevated p-6 md:p-8">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-accent-cyan" />
          <h1 className="text-display-sm text-text-primary"><T>IntuneGet Curated Catalog</T></h1>
        </div>
        <p className="mt-3 max-w-3xl text-text-secondary"><T>Selected applications with reviewed publisher sources and tested deployment configurations. Each release becomes available after verification and approval.</T></p>
        <p className="mt-3 text-sm text-text-secondary">{approvedCount} <T>approved</T> · {data?.entries.length || 10} <T>pilot applications</T> · <T>64-bit Windows, machine installation</T></p>
      </section>
      <label className="block">
        <span className="sr-only"><T>Search curated applications</T></span>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search curated applications" className="w-full rounded-xl border border-overlay/10 bg-bg-elevated px-4 py-3 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan" />
      </label>
      {isPending && <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /><T>Loading curated applications…</T></p>}
      {(error || expired) && <div role="alert" className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-4 text-text-primary">
        <p><T>The curated catalog is temporarily unavailable. Please try again later.</T></p>
        <button disabled={isFetching} onClick={() => void refetch()} className="mt-2 text-sm text-accent-cyan disabled:opacity-50"><T>Try again</T></button>
      </div>}
      {!error && !isPending && visible.length === 0 && <p className="text-text-secondary"><T>No curated applications match your search.</T></p>}
      {!error && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ app, status, release, cartItem }) => {
          const inCart = items.some(item => item.sourceType === 'curated' && 'curatedReleaseId' in item && item.curatedReleaseId === release?.id);
          return <article key={app.id} className="flex flex-col rounded-xl border border-overlay/10 bg-bg-elevated p-5">
            <div className="flex items-start justify-between gap-3">
              <Package className="h-6 w-6 shrink-0 text-accent-cyan" />
              <span className={`inline-flex items-center gap-1.5 text-xs ${status === 'approved' ? 'text-status-success' : 'text-text-secondary'}`}>
                {status === 'approved' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                {status === 'approved' ? <T>Approved release</T> : status === 'withdrawn' ? <T>Release withdrawn</T> : <T>Awaiting verification</T>}
              </span>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-text-primary">{app.name}</h2>
            <p className="mt-1 text-sm text-text-secondary">{app.publisher}</p>
            <p className="mt-2 text-xs text-text-secondary">{app.channel} · {app.architecture} · {app.locale}</p>
            {release && <div className="mt-4 space-y-2 text-sm text-text-secondary">
              <p><T>Approved version</T>: <span className="text-text-primary">{release.version}</span></p>
              <p><T>Tested</T>: {new Date(release.testedAt).toLocaleDateString()}</p>
              <div className="flex flex-wrap gap-3">
                <a href={release.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-accent-cyan"><T>Installer source</T></a>
                <a href={release.testReportUrl} target="_blank" rel="noopener noreferrer" className="text-accent-cyan"><T>Test results</T></a>
                <a href={release.securityReportUrl} target="_blank" rel="noopener noreferrer" className="text-accent-cyan"><T>Security scan</T></a>
              </div>
              <p className="break-all font-mono text-[10px]" title="Installer SHA256">{release.installerSha256}</p>
            </div>}
            <p className="mt-4 text-xs text-text-secondary">{app.autoUpdate === 'vendor-managed' ? <T>The vendor's update mechanism remains enabled.</T> : <T>New deployments use the approved catalog release.</T>}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
              <a href={app.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"><T>Publisher</T><ExternalLink className="h-3 w-3" /></a>
              <button disabled={!cartItem || inCart || expired} onClick={() => {
                if (!cartItem || expired || (data?.expiresAt && Date.parse(data.expiresAt) <= Date.now())) return;
                addItem(cartItem); toast.success(`${app.name} added to cart`);
              }} className="rounded-lg bg-accent-cyan px-3 py-2 text-sm font-medium text-bg-primary disabled:cursor-not-allowed disabled:opacity-40">
                {inCart ? <T>In cart</T> : <T>Add to cart</T>}
              </button>
            </div>
          </article>;
        })}
      </div>}
    </div>
  );
}
