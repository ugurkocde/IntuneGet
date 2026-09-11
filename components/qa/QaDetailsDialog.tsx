'use client';

import { Fragment, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileClock,
  Gauge,
  Loader2,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShieldQuestion,
  TerminalSquare,
  XCircle,
} from 'lucide-react';
import { VirusTotalIcon } from '@/components/qa/VirusTotalIcon';
import { T, Var } from 'gt-next';
import { AppIcon } from '@/components/AppIcon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getEvidencePhaseStatus, getEvidenceSummary, QA_RESULT_PHASES, type QaPhaseKey } from '@/lib/qa/evidence-presentation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QaDetailsRequestError, useQaDetails } from '@/hooks/use-qa';
import { formatQaDuration } from '@/lib/qa/presentation';
import { qaVersionMismatchKind } from '@/lib/qa/version-mismatch';
import { cn } from '@/lib/utils';
import {
  QA_CHANGE_CATEGORIES,
  type QaChangeSet,
  type QaPhaseResult,
  type QaPromptConfiguration,
  type QaVirusTotalSummary,
} from '@/types/qa';

interface QaDetailsDialogProps {
  wingetId: string;
  catalogVersion: string;
  packageProfileSha256?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_LABELS: Record<(typeof QA_CHANGE_CATEGORIES)[number], string> = {
  uninstallEntries: 'Uninstall entries',
  registryValues: 'Registry values',
  fileSystemItems: 'Files and directories',
  operatingSystem: 'Operating system',
  drivers: 'Drivers',
  windowsFeatures: 'Windows features',
  services: 'Services',
  scheduledTasks: 'Scheduled tasks',
  shortcuts: 'Shortcuts',
};

function PromptConfigurationSummary({ configuration }: { configuration: QaPromptConfiguration }) {
  const enabled: Array<{ key: string; content: ReactNode }> = [];
  if (configuration.closePrompt) enabled.push({ key: 'close', content: <T>Close prompt</T> });
  if (configuration.deferral) enabled.push({ key: 'deferral', content: <T>Deferral</T> });
  if (configuration.progressDialog) enabled.push({ key: 'progress', content: <T>Progress dialog</T> });
  if (configuration.customPromptCount > 0) {
    enabled.push({
      key: 'custom',
      content: configuration.customPromptCount === 1
        ? <T><Var>{configuration.customPromptCount}</Var> custom prompt</T>
        : <T><Var>{configuration.customPromptCount}</Var> custom prompts</T>,
    });
  }
  if (configuration.restartPrompt) enabled.push({ key: 'restart', content: <T>Restart prompt</T> });
  if (configuration.balloonTipCount > 0) {
    enabled.push({
      key: 'balloon',
      content: configuration.balloonTipCount === 1
        ? <T><Var>{configuration.balloonTipCount}</Var> balloon tip</T>
        : <T><Var>{configuration.balloonTipCount}</Var> balloon tips</T>,
    });
  }
  if (enabled.length === 0) return <T>No prompts configured</T>;

  return (
    <>
      {enabled.map((item, index) => (
        <Fragment key={item.key}>{index > 0 ? ' · ' : null}{item.content}</Fragment>
      ))}
    </>
  );
}

function QaVersionMismatchNotice({ testedVersion, catalogVersion }: { testedVersion: string; catalogVersion: string }) {
  const mismatchKind = qaVersionMismatchKind(testedVersion, catalogVersion);
  if (mismatchKind === 'catalog-older') {
    return <T>This QA result is for version <Var>{testedVersion}</Var>; the catalog still offers the older version <Var>{catalogVersion}</Var>. The newer tested version has not been promoted to the catalog.</T>;
  }
  if (mismatchKind === 'catalog-newer') {
    return <T>This QA result is for version <Var>{testedVersion}</Var>; the catalog now offers the newer version <Var>{catalogVersion}</Var>. The outcome may not apply to that version.</T>;
  }
  return <T>This QA result is for version <Var>{testedVersion}</Var>; the catalog version is <Var>{catalogVersion}</Var>. The identifiers differ, so QA applies only to the exact tested version.</T>;
}

function ChangeTable({ title, changes }: { title: string; changes: QaChangeSet }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated/40" open={title === 'Changes after installation'}>
      <summary className="cursor-pointer px-4 py-3.5 text-sm font-medium text-text-primary transition-colors hover:bg-overlay/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan">
        <T>{title}</T>
      </summary>
      <div className="overflow-x-auto border-t border-overlay/10">
        <table className="w-full text-left text-xs">
          <thead className="bg-bg-deepest/30 text-text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium"><T>Area</T></th>
              <th className="px-3 py-2.5 text-right font-medium"><T>Added</T></th>
              <th className="px-3 py-2.5 text-right font-medium"><T>Updated</T></th>
              <th className="px-4 py-2.5 text-right font-medium"><T>Removed</T></th>
            </tr>
          </thead>
          <tbody>
            {QA_CHANGE_CATEGORIES.map((category) => (
              <tr key={category} className="border-t border-overlay/5 text-text-secondary">
                <td className="px-4 py-2.5"><T>{CATEGORY_LABELS[category]}</T></td>
                <td className="px-3 py-2.5 text-right font-mono">{changes[category].added}</td>
                <td className="px-3 py-2.5 text-right font-mono">{changes[category].changed}</td>
                <td className="px-4 py-2.5 text-right font-mono">{changes[category].removed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Clock3;
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 gap-3 rounded-2xl border border-overlay/10 bg-bg-elevated/45 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-cyan/10 text-accent-cyan">
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-text-muted">{label}</span>
        <span className="mt-1 block break-words text-sm font-medium text-text-primary">{children}</span>
      </span>
    </div>
  );
}

function LifecycleCard({ name, phaseKey, result }: { name: string; phaseKey: QaPhaseKey; result: QaPhaseResult | null }) {
  const status = getEvidencePhaseStatus(phaseKey, result);
  const Icon = status.passed === true ? CheckCircle2 : status.passed === false ? XCircle : Clock3;

  return (
    <div className={cn(
      'rounded-2xl border border-overlay/10 bg-bg-elevated/40 p-4',
      status.passed === true && 'border-t-2 border-t-status-success/70',
      status.passed === false && 'border-t-2 border-t-status-error/70'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-text-muted"><T>{name}</T></p>
          <p className={cn(
            'mt-1 text-sm font-medium',
            status.passed === true ? 'text-status-success' : status.passed === false ? 'text-status-error' : 'text-text-muted'
          )}><T>{status.label}</T></p>
        </div>
        <Icon className={cn(
          'h-5 w-5 shrink-0',
          status.passed === true ? 'text-status-success' : status.passed === false ? 'text-status-error' : 'text-text-muted'
        )} aria-hidden="true" />
      </div>
      <div className="mt-4 flex justify-between gap-3 border-t border-overlay/10 pt-3 text-xs text-text-muted">
        <span><T>Exit</T> <code className="text-text-secondary">{result?.exitCode ?? '—'}</code></span>
        <span className="font-mono text-text-secondary">{formatQaDuration(result?.durationSeconds)}</span>
      </div>
    </div>
  );
}

function VirusTotalBanner({ virusTotal, installerSha256 }: { virusTotal: QaVirusTotalSummary; installerSha256: string | null }) {
  const clean = virusTotal.status === 'clean';
  const flagged = virusTotal.status === 'flagged';
  const suspicious = virusTotal.status === 'suspicious';
  const attention = flagged || suspicious;
  const Icon = clean ? ShieldCheck : ShieldQuestion;
  const reportLink = installerSha256 ? (
    <a href={`https://www.virustotal.com/gui/file/${installerSha256.toLowerCase()}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-accent-cyan hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan">
      <T>View VirusTotal report</T><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  ) : null;

  if (!attention) {
    return (
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-overlay/10 px-4 py-3" aria-label="Installer reputation">
        <div className="flex min-w-0 items-start gap-3">
          <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', clean ? 'text-status-success' : 'text-text-muted')} aria-hidden="true" />
          <div>
            <h3 className="text-sm font-medium text-text-primary"><T>{clean ? 'VirusTotal: no detections reported' : 'VirusTotal: no verdict available'}</T></h3>
            <p className="mt-1 text-xs leading-5 text-text-muted">{clean ? <T><Var>{virusTotal.malicious ?? 0}</Var> malicious detections<Var>{virusTotal.totalEngines ? ` across ${virusTotal.totalEngines} vendors` : ""}</Var> at the time of this check.</T> : <T>No reputation verdict was recorded for this installer.</T>}</p>
            {virusTotal.scannedAtUtc ? <p className="mt-1 text-xs text-text-muted"><T>Analyzed <Var>{new Date(virusTotal.scannedAtUtc).toLocaleDateString()}</Var></T></p> : null}
          </div>
        </div>
        {reportLink}
      </section>
    );
  }
  return (
    <section className={cn('rounded-xl border p-4', flagged ? 'border-status-error/25 bg-status-error/5' : 'border-status-warning/25 bg-status-warning/5')} aria-label="Installer reputation finding">
      <div className="flex items-start gap-3">
        <VirusTotalIcon className={cn('mt-0.5 h-6 w-6 shrink-0', flagged ? 'text-status-error' : 'text-status-warning')} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary"><T>{flagged ? 'Installer flagged by VirusTotal' : 'Suspicious VirusTotal verdict'}</T></h3>
          <p className="mt-1 text-sm leading-6 text-text-secondary"><T><Var>{virusTotal.malicious ?? 0}</Var> malicious and <Var>{virusTotal.suspicious ?? 0}</Var> suspicious detections<Var>{virusTotal.totalEngines ? ` across ${virusTotal.totalEngines} vendors` : ""}</Var>.</T></p>
          <p className="mt-1 text-xs leading-5 text-text-secondary"><T>{flagged ? 'Packaging of this version is blocked until the finding is reviewed.' : 'This verdict does not block this version. Review the vendor findings for details.'}</T></p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">{reportLink}<span className="text-xs text-text-muted"><T>Hash-only lookup; the installer is not uploaded.</T></span></div>
          {virusTotal.scannedAtUtc ? <p className="text-xs text-text-muted"><T>Analyzed <Var>{new Date(virusTotal.scannedAtUtc).toLocaleDateString()}</Var></T></p> : null}
        </div>
      </div>
    </section>
  );
}

function DetailsSkeleton({ wingetId }: { wingetId: string }) {
  return (
    <div className="space-y-6" aria-label="Loading QA result">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-2xl border border-overlay/10 bg-bg-elevated motion-reduce:animate-none" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-4 w-36 animate-pulse rounded bg-overlay/10 motion-reduce:animate-none" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-2xl border border-overlay/10 bg-bg-elevated motion-reduce:animate-none" />
          ))}
        </div>
      </div>
      <div className="h-52 animate-pulse rounded-2xl border border-overlay/10 bg-bg-elevated motion-reduce:animate-none" />
      <p className="sr-only"><T>Loading the exact QA result for <Var>{wingetId}</Var>.</T></p>
    </div>
  );
}

export function QaDetailsDialog({
  wingetId,
  catalogVersion,
  packageProfileSha256,
  open,
  onOpenChange,
}: QaDetailsDialogProps) {
  const { data, error, isLoading, isFetching, refetch } = useQaDetails(
    wingetId,
    packageProfileSha256,
    open
  );
  const requestError = error instanceof QaDetailsRequestError ? error : null;
  const isPublishing = requestError?.status === 404;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(48rem,92dvh)] w-[calc(100%_-_1.5rem)] max-w-4xl flex-col bg-bg-surface">
        <DialogHeader className="shrink-0 px-5 py-5 pr-12 sm:px-6 sm:pr-14">
          <div className="flex items-center gap-4">
            <AppIcon
              packageId={wingetId}
              packageName={data?.displayName || wingetId}
              size="lg"
              className="shadow-sm"
            />
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs font-medium uppercase tracking-[0.16em] text-accent-cyan"><T>Application QA</T></span>
                {data ? (
                  <span className={cn(
                    'inline-flex items-center gap-1.5 text-xs font-medium',
                    data.outcome === 'Passed' ? 'text-status-success' : 'text-status-error'
                  )}>
                    {data.outcome === 'Passed'
                      ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      : <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                    <T>{data.outcome}</T>
                  </span>
                ) : null}
              </div>
              <DialogTitle className="break-words text-xl [overflow-wrap:anywhere]">
                {data?.displayName || <T>Installation test details</T>}
              </DialogTitle>
              <DialogDescription className="mt-1 break-words [overflow-wrap:anywhere]">
                {data
                  ? <>{wingetId} · <T>Version <Var>{data.testedVersion}</Var></T> · {data.architecture}</>
                  : <T>Loading the exact isolated test run and its evidence.</T>}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {isLoading ? (
            <div className="overflow-y-auto p-5 sm:p-6"><DetailsSkeleton wingetId={wingetId} /></div>
          ) : !data ? (
            <div className="mx-auto flex min-h-0 max-w-xl flex-1 flex-col items-center overflow-y-auto p-6 text-center" role="alert">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-status-warning/10 text-status-warning">
                {isPublishing
                  ? <FileClock className="h-6 w-6" aria-hidden="true" />
                  : <AlertTriangle className="h-6 w-6" aria-hidden="true" />}
              </span>
              <h3 className="mt-5 text-lg font-semibold text-text-primary">
                {isPublishing ? <T>This test result is still being prepared</T> : <T>We could not load this test result</T>}
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-text-secondary">
                {isPublishing
                  ? <T>The run is complete, but its evidence is still being published. Retry in a moment.</T>
                  : <T>The evidence service may be temporarily unavailable. The QA result itself has not been lost.</T>}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent-cyan px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-cyan-bright disabled:cursor-wait disabled:opacity-70"
              >
                {isFetching
                  ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                <T>Try again</T>
              </button>
            </div>
          ) : (
            <Tabs key={`${wingetId}-${packageProfileSha256 || 'latest'}`} defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-overlay/10 px-5 py-3 sm:px-6">
                <TabsList className="grid w-full grid-cols-3 sm:w-fit" aria-label="Completed test evidence">
                  <TabsTrigger value="overview" className="min-h-9 px-2 sm:px-3"><T>Overview</T></TabsTrigger>
                  <TabsTrigger value="changes" className="min-h-9 px-2 sm:px-3"><T>Changes</T></TabsTrigger>
                  <TabsTrigger value="technical" className="min-h-9 px-2 text-xs sm:px-3 sm:text-sm"><T>Technical details</T></TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="overview" className="m-0 min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
                <section className={cn('rounded-xl border p-4', data.outcome === 'Passed' ? 'border-status-success/20 bg-status-success/5' : 'border-status-error/20 bg-status-error/5')}>
                  <h3 className="text-base font-semibold text-text-primary"><T>{data.outcome === 'Passed' ? 'Test passed' : 'Test failed'}</T></h3>
                  <p className="mt-1 text-sm leading-6 text-text-secondary"><T>{getEvidenceSummary(data.outcome, data.phases)}</T></p>
                </section>
                {data.testedVersion !== catalogVersion ? (
                  <div className="flex gap-3 rounded-2xl border border-status-warning/20 bg-status-warning/10 p-4 text-sm leading-6 text-status-warning">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <p><QaVersionMismatchNotice testedVersion={data.testedVersion} catalogVersion={catalogVersion} /></p>
                  </div>
                ) : null}

                {data.virusTotal && (data.virusTotal.status === 'flagged' || data.virusTotal.status === 'suspicious') ? (
                  <VirusTotalBanner virusTotal={data.virusTotal} installerSha256={data.installerSha256} />
                ) : null}
                <section aria-labelledby="qa-summary-heading">
                  <h3 id="qa-summary-heading" className="sr-only"><T>Test summary</T></h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SummaryItem icon={Clock3} label={<T>Total duration</T>}>
                      {formatQaDuration(data.overallDurationSeconds)}
                    </SummaryItem>
                    <SummaryItem icon={PackageCheck} label={<T>Installer</T>}>
                      {data.installerType?.toUpperCase() || <T>Type unknown</T>}
                    </SummaryItem>
                    <SummaryItem icon={Gauge} label={<T>Tested</T>}>
                      {new Date(data.testedAtUtc).toLocaleString()}
                    </SummaryItem>
                  </div>
                </section>

                <section className="space-y-3" aria-labelledby="qa-lifecycle-heading">
                  <div>
                    <h3 id="qa-lifecycle-heading" className="text-base font-semibold text-text-primary"><T>Installation lifecycle</T></h3>
                    <p className="mt-1 text-sm text-text-muted"><T>Recorded checks from this isolated Windows test.</T></p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {QA_RESULT_PHASES.map(({ key, label }) => (
                      <LifecycleCard key={key} phaseKey={key} name={label} result={data.phases[key]} />
                    ))}
                  </div>
                </section>

                {data.virusTotal && data.virusTotal.status !== 'flagged' && data.virusTotal.status !== 'suspicious' ? (
                  <VirusTotalBanner virusTotal={data.virusTotal} installerSha256={data.installerSha256} />
                ) : null}

              </TabsContent>
              <TabsContent value="changes" className="m-0 min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
                {data.changes ? (
                  <section className="space-y-3" aria-labelledby="qa-changes-heading">
                    <div>
                      <h3 id="qa-changes-heading" className="text-base font-semibold text-text-primary"><T>Observed system changes</T></h3>
                      <p className="mt-1 text-sm text-text-muted"><T>Compare installation counts with the changes remaining after uninstall. Detailed paths are not retained in this result.</T></p>
                    </div>
                    <p className="text-xs leading-relaxed text-text-muted"><T>Counts are correlated with the test window, not attributed to the app; background Windows activity is included. A nonzero residual does not mean the uninstall was dirty.</T></p>
                    <ChangeTable title="Changes after installation" changes={data.changes.afterInstall} />
                    {data.phases.uninstall ? <ChangeTable title="Residual changes after uninstall" changes={data.changes.residualAfterUninstall} /> : <p className="rounded-xl border border-overlay/10 p-4 text-sm text-text-muted"><T>Uninstall was not run; no removal comparison is available.</T></p>}
                  </section>
                ) : <p className="rounded-xl border border-dashed border-overlay/15 p-6 text-sm text-text-muted"><T>System-change counts were not recorded for this run.</T></p>}

              </TabsContent>
              <TabsContent value="technical" className="m-0 min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-6">
                {data.effectiveConfiguration ? (
                  <section className="overflow-hidden rounded-2xl border border-overlay/10" aria-labelledby="qa-configuration-heading">
                    <div className="flex items-center gap-3 border-b border-overlay/10 bg-bg-elevated/50 px-5 py-4">
                      <Settings2 className="h-4.5 w-4.5 text-accent-cyan" aria-hidden="true" />
                      <div>
                        <h3 id="qa-configuration-heading" className="text-sm font-semibold text-text-primary"><T>Test configuration</T></h3>
                        <p className="mt-0.5 text-xs text-text-muted"><T>The effective PSADT settings used for this exact run.</T></p>
                      </div>
                    </div>
                    <div className="grid gap-x-6 gap-y-5 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div><span className="block text-xs text-text-muted"><T>Deploy mode</T></span><code className="mt-1 block text-text-primary">{data.effectiveConfiguration.deployMode}</code></div>
                      <div><span className="block text-xs text-text-muted"><T>Restart behavior</T></span><code className="mt-1 block text-text-primary">{data.effectiveConfiguration.restartBehavior}</code></div>
                      <div><span className="block text-xs text-text-muted"><T>Processes to close</T></span><span className="mt-1 block font-medium text-text-primary">{data.effectiveConfiguration.processCloseCount}</span></div>
                      <div><span className="block text-xs text-text-muted"><T>UI evidence expected</T></span><span className="mt-1 block font-medium text-text-primary"><T>{data.effectiveConfiguration.uiEvidenceExpected ? 'Yes' : 'No'}</T></span></div>
                      <div className="sm:col-span-2 lg:col-span-4"><span className="block text-xs text-text-muted"><T>Prompt configuration</T></span><span className="mt-1 block text-text-primary"><PromptConfigurationSummary configuration={data.effectiveConfiguration.promptConfiguration} /></span></div>
                      <div className="sm:col-span-2 lg:col-span-4">
                        <span className="block text-xs text-text-muted"><T>Vendor silent arguments</T></span>
                        <code className="mt-1.5 block overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-bg-deepest/60 px-3 py-2.5 text-xs text-text-secondary">
                          {data.effectiveConfiguration.vendorSilentArguments === null
                            ? <T>Custom deployment arguments withheld</T>
                            : data.effectiveConfiguration.vendorSilentArguments || <T>No arguments required</T>}
                        </code>
                      </div>
                    </div>
                  </section>
                ) : null}

                <section className="overflow-hidden rounded-2xl border border-overlay/10" aria-labelledby="qa-method-heading">
                  <div className="flex items-center gap-3 border-b border-overlay/10 bg-bg-elevated/50 px-5 py-4">
                    <TerminalSquare className="h-4.5 w-4.5 text-accent-cyan" aria-hidden="true" />
                    <div>
                      <h3 id="qa-method-heading" className="text-sm font-semibold text-text-primary"><T>Installation method</T></h3>
                      <p className="mt-0.5 text-xs text-text-muted"><T>Commands and detection logic used by the package.</T></p>
                    </div>
                  </div>
                  <div className="space-y-5 p-5">
                    <div>
                      <p className="mb-1.5 text-xs text-text-muted"><T>Install command</T></p>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-bg-deepest/60 p-3 text-xs text-text-secondary">{data.commands.install}</pre>
                    </div>
                    <div>
                      <p className="mb-1.5 text-xs text-text-muted"><T>Uninstall command</T></p>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-bg-deepest/60 p-3 text-xs text-text-secondary">{data.commands.uninstall}</pre>
                    </div>
                    <p className="text-xs leading-5 text-text-secondary">
                      {data.detection.type === 'fileVersion' ? (
                        <T>Detection: file version at <Var><code className="rounded bg-bg-deepest px-1 py-0.5">{data.detection.path}</code></Var> must be at least <Var>{data.detection.minimumVersion}</Var>.</T>
                      ) : (
                        <T>Detection: <Var>{data.detection.description}</Var>.</T>
                      )}
                    </p>
                  </div>
                </section>

                <section className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-overlay/10 pt-5 text-xs text-text-muted">
                  <span><T>Publisher</T>: <span className="text-text-secondary">{data.publisher || <T>Not recorded</T>}</span></span>
                  <span>PSADT <span className="text-text-secondary">{data.package?.psadtVersion || <T>version unknown</T>}</span></span>
                  <span><T>Windows events</T>: <span className="text-text-secondary">{data.relevantEventCount ?? <T>Not recorded</T>}</span></span>
                </section>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
