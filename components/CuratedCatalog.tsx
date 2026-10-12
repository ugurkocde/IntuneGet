'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft, Check, CheckCircle2, ChevronDown, Clock, Download, ExternalLink, FileText, FlaskConical, Loader2, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { T, Var } from 'gt-next';
import { AppIcon } from '@/components/AppIcon';
import { getInstallerLabel, installerTypeStyles } from '@/components/AppCard';
import { CategoryBadge } from '@/components/CategoryFilter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const agreementLink = (
    <a href={attestation.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-cyan">
      <T><Var>{attestation.title}</Var></T><ExternalLink className="h-3 w-3" />
    </a>
  );
  if (isLoading) {
    return <p role="status" className="mt-4 flex items-center gap-2 text-xs text-text-secondary"><Loader2 className="h-3 w-3 animate-spin" /><T>Checking licence acceptance for this tenant…</T></p>;
  }
  if (accepted) {
    return (
      <div className="mt-4 space-y-1 text-xs">
        <p className="flex items-start gap-1.5 text-status-success">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><T>Licence accepted for this tenant on <Var>{status?.acceptedAt ? new Date(status.acceptedAt).toLocaleDateString() : ''}</Var> by <Var>{status?.acceptedByEmail || 'an administrator'}</Var>.</T></span>
        </p>
        {agreementLink}
      </div>
    );
  }
  return (
    <details className="group/licence mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-text-primary [&::-webkit-details-marker]:hidden">
        <FileText className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="flex-1"><T>Licence agreement required</T></span>
        <ChevronDown className="h-4 w-4 text-text-muted transition-transform group-open/licence:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-amber-500/20 px-3 py-3">
        {agreementLink}
        <p className="text-xs text-text-secondary"><T>The publisher requires your organization to accept this agreement before IntuneGet deploys the application to this tenant. Automatic updates are also paused until it is accepted.</T></p>
        <label htmlFor={`licence-${appId}`} className="flex cursor-pointer items-start gap-2.5">
          <input id={`licence-${appId}`} type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-overlay/30 accent-cyan-600" />
          <span className="text-xs text-text-primary"><T>I have reviewed the agreement and accept it on behalf of my organization for this tenant.</T></span>
        </label>
        <button type="button" disabled={!confirmed || isAccepting} onClick={onAccept} className="rounded-lg border border-accent-cyan/40 px-3 py-1.5 text-xs font-medium text-accent-cyan disabled:cursor-not-allowed disabled:opacity-40">
          {isAccepting ? <T>Recording acceptance…</T> : <T>Accept agreement</T>}
        </button>
      </div>
    </details>
  );
}

interface CatalogResponse {
  expiresAt: string | null;
  entries: Array<{
    app: Pick<CuratedAppDefinition, 'id' | 'name' | 'publisher' | 'channel' | 'category' | 'homepage' | 'architecture' | 'scope' | 'locale' | 'autoUpdate'>
      & Partial<Pick<CuratedAppDefinition, 'wingetId' | 'installerType'>>
      & { licenceAttestation: CuratedLicenceAttestation | null };
    status: 'pending' | 'approved' | 'withdrawn';
    release: { id: string; version: string; approvedAt: string; installerSha256: string; sourceUrl: string; testedAt: string; testReportUrl: string; securityReportUrl: string; signatureStatus: string } | null;
    cartItem: Omit<Win32CartItem, 'id' | 'addedAt'> | null;
  }>;
}

type CatalogEntry = CatalogResponse['entries'][number];

const evidenceLinkClass = 'text-text-muted hover:text-accent-cyan transition-colors p-1';

function CuratedAppCard({ entry, inCart, expired, licenceStatus, licenceLoading, isAccepting, onAccept, onSelect }: {
  entry: CatalogEntry;
  inCart: boolean;
  expired: boolean;
  licenceStatus: AttestationStatus | undefined;
  licenceLoading: boolean;
  isAccepting: boolean;
  onAccept: () => void;
  onSelect: () => void;
}) {
  const { app, status, release, cartItem } = entry;
  const licence = app.licenceAttestation;
  const licenceAccepted = !licence || Boolean(licenceStatus?.accepted && licenceStatus.attestation.version === licence.version);
  const iconId = app.wingetId || app.id;
  const installerType = app.installerType?.toLowerCase();

  return (
    <article
      id={app.id}
      tabIndex={-1}
      aria-label={`${app.name} by ${app.publisher}${release ? `, version ${release.version}` : ''}${inCart ? ', selected' : ''}`}
      className="group relative flex flex-col scroll-mt-28 rounded-2xl border border-overlay/10 bg-bg-elevated p-5 contain-layout transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-cyan/30 hover:shadow-card-hover target:border-accent-cyan/50"
    >
      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <AppIcon
            packageId={iconId}
            packageName={app.name}
            size="xl"
            className="group-hover:border-accent-cyan/30 transition-all duration-200 group-hover:scale-[1.03]"
          />
          <div className="absolute -inset-1 bg-gradient-to-br from-accent-cyan/20 to-transparent rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-10" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-text-primary font-semibold text-base truncate group-hover:text-accent-cyan transition-colors">{app.name}</h2>
              <p className="text-text-secondary text-sm truncate">{app.publisher}</p>
              <p className="text-[11px] text-text-muted font-mono truncate mt-1">{iconId}</p>
            </div>
            {release && (
              <span className="text-xs text-text-secondary bg-bg-surface px-2.5 py-1 rounded-md flex-shrink-0 border border-overlay/10">
                v{release.version}
              </span>
            )}
          </div>

          <p className="text-text-secondary text-sm mt-3 line-clamp-2 leading-relaxed min-h-[2.75rem]">
            {release
              ? <T>Tested <Var>{new Date(release.testedAt).toLocaleDateString()}</Var> in an isolated virtual machine. Installer pinned by SHA-256 hash.</T>
              : status === 'withdrawn'
                ? <T>The previous release was withdrawn. A new release becomes available once it passes verification.</T>
                : <T>The first release becomes available once it passes verification.</T>}
          </p>

          <div className="flex items-center flex-wrap gap-1.5 mt-3">
            {status === 'approved' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success bg-status-success/10 px-2 py-0.5 rounded-full border border-status-success/20">
                <ShieldCheck className="h-3 w-3" /><T>Curated</T>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-text-secondary bg-bg-surface px-2 py-0.5 rounded-full border border-overlay/10">
                <Clock className="h-3 w-3" />
                {status === 'withdrawn' ? <T>Withdrawn</T> : <T>Awaiting verification</T>}
              </span>
            )}
            {app.category && <CategoryBadge category={app.category} />}
            {installerType && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${installerTypeStyles[installerType] || 'text-text-secondary bg-bg-surface border-overlay/10'}`}>
                {getInstallerLabel(installerType)}
              </span>
            )}
            <span className="text-xs text-text-secondary bg-bg-surface px-2 py-0.5 rounded-full border border-overlay/10">{app.architecture}</span>
          </div>
        </div>
      </div>

      {licence && <LicenceAttestationPanel appId={app.id} attestation={licence} status={licenceStatus}
        isLoading={licenceLoading} isAccepting={isAccepting} onAccept={onAccept} />}

      <div className="mt-auto pt-4">
        <div className="flex w-full items-center justify-between border-t border-overlay/10 pt-4">
          <div className="flex items-center gap-1">
            <a href={app.homepage} target="_blank" rel="noopener noreferrer" className={evidenceLinkClass} aria-label={`Open ${app.name} homepage`} title="Publisher homepage">
              <ExternalLink className="w-4 h-4" />
            </a>
            {release && <>
              <a href={release.testReportUrl} target="_blank" rel="noopener noreferrer" className={evidenceLinkClass} aria-label={`${app.name} test results`} title="Test results">
                <FlaskConical className="w-4 h-4" />
              </a>
              <a href={release.securityReportUrl} target="_blank" rel="noopener noreferrer" className={evidenceLinkClass} aria-label={`${app.name} security scan`} title="Security scan">
                <ShieldCheck className="w-4 h-4" />
              </a>
              <a href={release.sourceUrl} target="_blank" rel="noopener noreferrer" className={evidenceLinkClass} aria-label={`${app.name} installer source`} title={`Installer source (SHA-256 ${release.installerSha256})`}>
                <Download className="w-4 h-4" />
              </a>
            </>}
          </div>

          <Button
            size="sm"
            onClick={onSelect}
            disabled={!cartItem || inCart || expired || !licenceAccepted}
            title={licenceAccepted ? undefined : 'Accept the licence agreement first'}
            aria-label={inCart ? `${app.name} already selected` : `Select ${app.name}`}
            className={inCart
              ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border border-status-success/20 disabled:opacity-100'
              : 'bg-accent-cyan hover:bg-accent-cyan-dim text-white border-0'}
          >
            {inCart
              ? <><Check className="w-4 h-4 mr-1.5" /><T>Selected</T></>
              : <><Plus className="w-4 h-4 mr-1.5" /><T>Select</T></>}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function CuratedCatalog() {
  const [query, setQuery] = useState('');
  const scrolledHash = useRef('');
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
  useEffect(() => {
    const appId = window.location.hash.slice(1);
    if (!appId || scrolledHash.current === appId || !data?.entries.some(entry => entry.app.id === appId)) return;
    const card = document.getElementById(appId);
    if (!card) return;
    // The catalog arrives after navigation, so Next.js cannot find the hash
    // target during its initial scroll. Do this once after the cards mount.
    scrolledHash.current = appId;
    card.scrollIntoView({ block: 'start' });
    card.focus({ preventScroll: true });
  }, [data]);
  const visible = data?.entries.filter(({ app }) => `${app.name} ${app.publisher} ${app.channel} ${app.wingetId || ''}`.toLowerCase().includes(query.trim().toLowerCase())) || [];
  const approvedCount = data?.entries.filter(entry => entry.status === 'approved').length || 0;
  const expired = Boolean(data?.expiresAt && Date.parse(data.expiresAt) <= Date.now());

  return (
    <div className="space-y-6 pb-4">
      <section className="relative overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated/95 shadow-soft-md p-6 md:p-8">
        <div className="absolute inset-0 pointer-events-none bg-gradient-radial-cyan opacity-60" />
        <div className="absolute right-0 top-0 h-28 w-28 md:h-40 md:w-40 bg-gradient-to-bl from-accent-violet/10 via-accent-cyan/5 to-transparent blur-2xl" />

        <div className="relative">
          <h1 className="text-display-sm text-text-primary"><T>Curated Catalog</T></h1>
          <p className="text-text-secondary mt-2 max-w-2xl">
            <T>Applications downloaded straight from their publishers. New releases are checked every 30 minutes and become available once they pass an automated install, upgrade and uninstall test in an isolated virtual machine.</T>
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/apps" className="inline-flex items-center gap-2 rounded-full border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-overlay/5">
              <ArrowLeft className="h-4 w-4" /><T>Winget catalog</T>
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
              <ShieldCheck className="w-4 h-4 text-status-success" />
              <span className="font-medium text-text-primary">{approvedCount}</span>
              <T>approved</T>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
              <RefreshCw className="w-4 h-4 text-accent-cyan" />
              <T>Checked every 30 minutes</T>
            </span>
          </div>
        </div>
      </section>

      <section className="sticky top-[4.5rem] z-20 -mx-1 px-1">
        <div className="rounded-2xl border border-overlay/10 bg-bg-elevated/95 backdrop-blur-md shadow-soft-lg p-3 md:p-4">
          <label className="relative block">
            <span className="sr-only"><T>Search curated applications</T></span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <Input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search curated applications"
              className="h-11 pl-10 bg-bg-surface border-overlay/10"
            />
          </label>
        </div>
      </section>

      {isPending && <p role="status" className="flex items-center gap-2 text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" /><T>Loading curated applications…</T></p>}
      {(error || expired) && <div role="alert" className="rounded-xl border border-status-warning/30 bg-status-warning/10 p-4 text-text-primary">
        <p><T>The curated catalog is temporarily unavailable. Please try again later.</T></p>
        <button disabled={isFetching} onClick={() => void refetch()} className="mt-2 text-sm text-accent-cyan disabled:opacity-50"><T>Try again</T></button>
      </div>}
      {!error && !isPending && visible.length === 0 && <p className="text-text-secondary"><T>No curated applications match your search.</T></p>}
      {!error && <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map(entry => {
          const { app, release, cartItem } = entry;
          const licence = app.licenceAttestation;
          const licenceStatus = attestations.data?.attestations.find(status => status.appId === app.id);
          const licenceAccepted = !licence || Boolean(licenceStatus?.accepted && licenceStatus.attestation.version === licence.version);
          return <CuratedAppCard
            key={app.id}
            entry={entry}
            inCart={items.some(item => item.sourceType === 'curated' && 'curatedReleaseId' in item && item.curatedReleaseId === release?.id)}
            expired={expired}
            licenceStatus={licenceStatus}
            licenceLoading={attestations.isLoading}
            isAccepting={accept.isPending && accept.variables?.appId === app.id}
            onAccept={() => licence && accept.mutate({ appId: app.id, attestation: licence }, {
              onSuccess: () => toast.success(`${licence.title} accepted for this tenant`),
              onError: mutationError => toast.error(mutationError.message),
            })}
            onSelect={() => {
              if (!cartItem || !licenceAccepted || (data?.expiresAt && Date.parse(data.expiresAt) <= Date.now())) return;
              addItem(cartItem); toast.success(`${app.name} added to cart`);
            }}
          />;
        })}
      </div>}
    </div>
  );
}
