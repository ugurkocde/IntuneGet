'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Clock, ExternalLink, FileText, Loader2, Package, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { T, Var } from 'gt-next';
import { useCartStore } from '@/stores/cart-store';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import type { CuratedAppDefinition, CuratedLicenceAttestation } from '@/lib/curated-catalog/types';
import type { Win32CartItem } from '@/types/upload';

interface AttestationStatus {
  appId: string;
  attestation: CuratedLicenceAttestation;
  accepted: boolean;
  acceptedAt: string | null;
  acceptedByEmail: string | null;
}

function useLicenceAttestations() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const queryClient = useQueryClient();
  const tenantKey = isMspUser ? selectedTenantId || 'primary' : 'self';
  const headers = async () => {
    const token = await getAccessToken();
    if (!token) throw new Error('Sign in again to continue.');
    return {
      Authorization: `Bearer ${token}`,
      ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
    };
  };
  const queryKey = ['curated-catalog', 'attestations', tenantKey];
  const query = useQuery<{ attestations: AttestationStatus[] }>({
    queryKey,
    queryFn: async () => {
      const response = await fetch('/api/curated-catalog/attestations', { headers: await headers(), cache: 'no-store' });
      if (!response.ok) throw new Error('Licence agreement status is temporarily unavailable.');
      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  });
  const accept = useMutation({
    mutationFn: async ({ appId, attestation }: { appId: string; attestation: CuratedLicenceAttestation }) => {
      const response = await fetch('/api/curated-catalog/attestations', {
        method: 'POST',
        headers: { ...(await headers()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, attestationId: attestation.id, attestationVersion: attestation.version, accepted: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The licence acceptance could not be recorded.');
      return body as AttestationStatus;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
  return { query, accept };
}

function LicenceAttestationPanel({ appId, attestation, status, isLoading, onAccept, isAccepting }: {
  appId: string;
  attestation: CuratedLicenceAttestation;
  status: AttestationStatus | undefined;
  isLoading: boolean;
  onAccept: () => void;
  isAccepting: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const accepted = Boolean(status?.accepted && status.attestation.version === attestation.version);
  return (
    <div className="mt-4 rounded-lg border border-overlay/10 bg-bg-primary/40 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-text-primary"><FileText className="h-4 w-4 text-accent-cyan" /><T>Licence agreement required</T></p>
      <a href={attestation.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-accent-cyan">
        <T><Var>{attestation.title}</Var></T><ExternalLink className="h-3 w-3" />
      </a>
      {isLoading ? (
        <p role="status" className="mt-2 flex items-center gap-2 text-xs text-text-secondary"><Loader2 className="h-3 w-3 animate-spin" /><T>Checking acceptance for this tenant…</T></p>
      ) : accepted ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-status-success">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><T>Accepted for this tenant on <Var>{status?.acceptedAt ? new Date(status.acceptedAt).toLocaleDateString() : ''}</Var> by <Var>{status?.acceptedByEmail || 'an administrator'}</Var>.</T></span>
        </p>
      ) : (
        <>
          <p className="mt-2 text-xs text-text-secondary"><T>The publisher requires your organization to accept this agreement before IntuneGet deploys the application to this tenant. Automatic updates are also paused until it is accepted.</T></p>
          <label htmlFor={`licence-${appId}`} className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input id={`licence-${appId}`} type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-overlay/30 accent-cyan-600" />
            <span className="text-xs text-text-primary"><T>I have reviewed the agreement and accept it on behalf of my organization for this tenant.</T></span>
          </label>
          <button type="button" disabled={!confirmed || isAccepting} onClick={onAccept} className="mt-3 rounded-lg border border-accent-cyan/40 px-3 py-1.5 text-xs font-medium text-accent-cyan disabled:cursor-not-allowed disabled:opacity-40">
            {isAccepting ? <T>Recording acceptance…</T> : <T>Accept agreement</T>}
          </button>
        </>
      )}
    </div>
  );
}

interface CatalogResponse {
  expiresAt: string | null;
  entries: Array<{
    app: Pick<CuratedAppDefinition, 'id' | 'name' | 'publisher' | 'channel' | 'category' | 'homepage' | 'architecture' | 'scope' | 'locale' | 'autoUpdate'> & { licenceAttestation: CuratedLicenceAttestation | null };
    status: 'pending' | 'approved' | 'withdrawn';
    release: { id: string; version: string; approvedAt: string; installerSha256: string; sourceUrl: string; testedAt: string; testReportUrl: string; securityReportUrl: string; signatureStatus: string } | null;
    cartItem: Omit<Win32CartItem, 'id' | 'addedAt'> | null;
  }>;
}

export function CuratedCatalog() {
  const [query, setQuery] = useState('');
  const addItem = useCartStore(state => state.addItem);
  const items = useCartStore(state => state.items);
  const { query: attestations, accept } = useLicenceAttestations();
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
          const licence = app.licenceAttestation;
          const licenceStatus = attestations.data?.attestations.find(entry => entry.appId === app.id);
          const licenceAccepted = !licence || Boolean(licenceStatus?.accepted && licenceStatus.attestation.version === licence.version);
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
            {licence && <LicenceAttestationPanel appId={app.id} attestation={licence} status={licenceStatus}
              isLoading={attestations.isLoading} isAccepting={accept.isPending && accept.variables?.appId === app.id}
              onAccept={() => accept.mutate({ appId: app.id, attestation: licence }, {
                onSuccess: () => toast.success(`${licence.title} accepted for this tenant`),
                onError: mutationError => toast.error(mutationError.message),
              })} />}
            <p className="mt-4 text-xs text-text-secondary">{app.autoUpdate === 'vendor-managed' ? <T>The vendor's update mechanism remains enabled.</T> : <T>New deployments use the approved catalog release.</T>}</p>
            <div className="mt-auto flex items-center justify-between gap-3 pt-5">
              <a href={app.homepage} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"><T>Publisher</T><ExternalLink className="h-3 w-3" /></a>
              <button disabled={!cartItem || inCart || expired || !licenceAccepted} title={licenceAccepted ? undefined : 'Accept the licence agreement first'} onClick={() => {
                if (!cartItem || !licenceAccepted || expired || (data?.expiresAt && Date.parse(data.expiresAt) <= Date.now())) return;
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
