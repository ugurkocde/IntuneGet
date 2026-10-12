'use client';

import { T } from 'gt-next';
import { AlertTriangle, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { QaVmViewer } from '@/components/qa/QaVmViewer';
import { StatusBadge } from '@/components/ui/status-badge';
import { getQaFrameState } from '@/lib/qa/presentation';
import { qaLiveFrameSrc, qaLiveViewerKey } from '@/lib/qa/live-view';
import type { QaCuratedLivePhase, QaLiveResponse } from '@/types/qa';
import styles from './QaLiveClient.module.css';

const PHASE_LABELS: Record<QaCuratedLivePhase, string> = {
  restoring_vm: 'Restoring golden VM', inspecting_installer: 'Checking installer integrity',
  preparing_package: 'Preparing package', testing_lifecycle: 'Testing package lifecycle',
  installing: 'Installing', detecting_install: 'Verifying installation', uninstalling: 'Uninstalling', verifying_removal: 'Verifying removal',
  installing_previous: 'Installing the previous version', detecting_previous: 'Verifying the previous installation',
  upgrading: 'Testing the upgrade', detecting_upgrade: 'Verifying the upgrade', final_uninstall: 'Uninstalling after the upgrade', verifying_final_removal: 'Verifying final removal', cleaning_up: 'Cleaning up the test',
};

export function QaCuratedCurrent({ data, elapsed }: { data: QaLiveResponse; elapsed: string }) {
  const current = data.current;
  if (current?.runKind !== 'curated') return null;
  const label = current.phase ? PHASE_LABELS[current.phase] : 'Waiting for lifecycle progress';
  const isPrivate = current.verification === 'custom-settings';
  const stalled = data.runner.state === 'stalled';
  const frameState = getQaFrameState({ available: data.viewer.available, capturedAt: data.viewer.capturedAt, serverTime: data.serverTime });
  return (
    <section className="overflow-hidden rounded-2xl border border-accent-cyan/20 bg-bg-elevated shadow-glow-cyan" aria-labelledby="current-test-heading">
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <AppIcon packageId={current.wingetId} packageName={current.displayName} size="xl" />
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <StatusBadge tone="accent" icon={stalled ? Clock : Loader2} iconClassName={stalled ? undefined : 'animate-spin motion-reduce:animate-none'}><T>Catalog verification</T></StatusBadge>
                {isPrivate ? <StatusBadge tone="neutral"><T>Custom settings</T></StatusBadge> : null}
                {stalled ? <StatusBadge tone="error" icon={AlertTriangle}><T>Waiting for updates</T></StatusBadge> : null}
              </div>
              <h2 id="current-test-heading" className="truncate text-xl font-semibold text-text-primary">{current.displayName}</h2>
              <p className="truncate text-sm text-text-muted">{current.wingetId}</p>
            </div>
          </div>
          <div className="flex items-center gap-5 sm:text-right">
            <div><p className="text-xs uppercase tracking-wide text-text-muted"><T>Version</T></p><p className="font-mono text-sm text-text-primary">{current.version} · {current.architecture}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-text-muted"><T>Elapsed</T></p><p className="font-mono text-lg font-semibold text-accent-cyan">{elapsed}</p></div>
          </div>
        </div>
        <p className="text-sm text-text-secondary" role="status"><T>{label}</T></p>
        <div className="relative isolate aspect-video w-full rounded-xl" role="group" aria-label="Live catalog verification VM">
          <span className={styles.viewerBorder} aria-hidden="true" />
          {isPrivate ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-black px-6 text-center">
              <ShieldCheck className="h-8 w-8 text-white/40" aria-hidden="true" />
              <p className="text-sm text-white/60"><T>The VM view is hidden to protect custom settings.</T></p>
            </div>
          ) : (
            <QaVmViewer key={qaLiveViewerKey(data)} src={qaLiveFrameSrc(data)} appName={current.displayName} phaseLabel={label} frameState={frameState} />
          )}
        </div>
      </div>
    </section>
  );
}
