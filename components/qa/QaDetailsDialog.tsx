'use client';

import { Fragment, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import { T, Var } from 'gt-next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { useQaDetails } from '@/hooks/use-qa';
import { formatQaDuration } from '@/lib/qa/presentation';
import { qaVersionMismatchKind } from '@/lib/qa/version-mismatch';
import {
  QA_CHANGE_CATEGORIES,
  type QaChangeSet,
  type QaPhaseResult,
  type QaPromptConfiguration,
} from '@/types/qa';

interface QaDetailsDialogProps {
  wingetId: string;
  catalogVersion: string;
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

function phaseStatus(
  name: string,
  result: QaPhaseResult | null
): { label: string; passed: boolean | null } {
  if (!result) return { label: 'Not run', passed: null };
  if (result.timedOut) return { label: 'Timed out', passed: false };
  if (name === 'Detection after uninstall') {
    return result.exitCode !== 0
      ? { label: 'Not detected (expected)', passed: true }
      : { label: 'Still detected', passed: false };
  }
  const passed = name.includes('Detection')
    ? result.exitCode === 0
    : [0, 3010, 1641].includes(result.exitCode);
  return { label: passed ? 'Passed' : 'Failed', passed };
}

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
    <details className="rounded-xl border border-overlay/10 bg-bg-elevated/50" open={title === 'Changes after installation'}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan">
        <T>{title}</T>
      </summary>
      <div className="overflow-x-auto border-t border-overlay/10">
        <table className="w-full text-left text-xs">
          <thead className="text-text-muted">
            <tr>
              <th className="px-4 py-2 font-medium"><T>Area</T></th>
              <th className="px-3 py-2 text-right font-medium"><T>Added</T></th>
              <th className="px-3 py-2 text-right font-medium"><T>Updated</T></th>
              <th className="px-4 py-2 text-right font-medium"><T>Removed</T></th>
            </tr>
          </thead>
          <tbody>
            {QA_CHANGE_CATEGORIES.map((category) => (
              <tr key={category} className="border-t border-overlay/5 text-text-secondary">
                <td className="px-4 py-2"><T>{CATEGORY_LABELS[category]}</T></td>
                <td className="px-3 py-2 text-right font-mono">{changes[category].added}</td>
                <td className="px-3 py-2 text-right font-mono">{changes[category].changed}</td>
                <td className="px-4 py-2 text-right font-mono">{changes[category].removed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function QaDetailsDialog({ wingetId, catalogVersion, open, onOpenChange }: QaDetailsDialogProps) {
  const { data, isLoading, isError } = useQaDetails(wingetId, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle><T>PSADT package QA details</T></DialogTitle>
          <DialogDescription><T>Latest isolated test of the package IntuneGet deploys through Intune.</T></DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> <T>Loading QA result…</T>
            </div>
          ) : isError || !data ? (
            <div className="rounded-xl border border-status-error/20 bg-status-error/10 p-4 text-sm text-status-error">
              <T>The QA result could not be loaded. Please try again.</T>
            </div>
          ) : (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">{data.displayName}</h3>
                    <p className="text-sm text-text-secondary">
                      <T>Version <Var>{data.testedVersion}</Var></T> · {data.architecture} · {data.publisher}
                    </p>
                  </div>
                  <StatusBadge
                    tone={data.outcome === 'Passed' ? 'success' : 'error'}
                    icon={data.outcome === 'Passed' ? CheckCircle2 : XCircle}
                  >
                    <T>QA <Var>{data.outcome}</Var></T>
                  </StatusBadge>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
                  <span>{new Date(data.testedAtUtc).toLocaleString()}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> {formatQaDuration(data.overallDurationSeconds)}</span>
                  <span>{data.installerType?.toUpperCase() || <T>Installer type unknown</T>}</span>
                  <span>PSADT {data.package?.psadtVersion || <T>version unknown</T>}</span>
                </div>
              </section>

              {data.testedVersion !== catalogVersion ? (
                <div className="flex gap-2 rounded-xl border border-status-warning/20 bg-status-warning/10 p-3 text-sm text-status-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p><QaVersionMismatchNotice testedVersion={data.testedVersion} catalogVersion={catalogVersion} /></p>
                </div>
              ) : null}

              {data.effectiveConfiguration ? (
                <section className="space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-text-primary"><T>Effective PSADT configuration</T></h4>
                    <p className="mt-1 text-xs text-text-muted"><T>Safe, compact settings from the exact package profile used for this test.</T></p>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-overlay/10 bg-bg-elevated/50 p-4 text-xs text-text-secondary sm:grid-cols-2 lg:grid-cols-4">
                    <div><span className="block text-text-muted"><T>Deploy mode</T></span><code>{data.effectiveConfiguration.deployMode}</code></div>
                    <div><span className="block text-text-muted"><T>Restart behavior</T></span><code>{data.effectiveConfiguration.restartBehavior}</code></div>
                    <div><span className="block text-text-muted"><T>Processes to close</T></span>{data.effectiveConfiguration.processCloseCount}</div>
                    <div><span className="block text-text-muted"><T>UI evidence expected</T></span><T>{data.effectiveConfiguration.uiEvidenceExpected ? 'Yes' : 'No'}</T></div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <span className="block text-text-muted"><T>Prompt configuration</T></span>
                      <PromptConfigurationSummary configuration={data.effectiveConfiguration.promptConfiguration} />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-text-muted"><T>Vendor silent arguments</T></p>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-overlay/10 bg-bg-deepest p-3 text-xs text-text-secondary">
                      {data.effectiveConfiguration.vendorSilentArguments === null
                        ? <T>Custom deployment arguments withheld</T>
                        : data.effectiveConfiguration.vendorSilentArguments || <T>No arguments required</T>}
                    </pre>
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-text-primary"><T>Silent installation method</T></h4>
                <div>
                  <p className="mb-1 text-xs text-text-muted"><T>Install command</T></p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-overlay/10 bg-bg-deepest p-3 text-xs text-text-secondary">{data.commands.install}</pre>
                </div>
                <div>
                  <p className="mb-1 text-xs text-text-muted"><T>Uninstall command</T></p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-overlay/10 bg-bg-deepest p-3 text-xs text-text-secondary">{data.commands.uninstall}</pre>
                </div>
                <p className="text-xs text-text-secondary">
                  {data.detection.type === 'fileVersion' ? (
                    <T>Detection: file version at <Var><code className="rounded bg-bg-deepest px-1 py-0.5">{data.detection.path}</code></Var> must be at least <Var>{data.detection.minimumVersion}</Var>.</T>
                  ) : (
                    <T>Detection: <Var>{data.detection.description}</Var>.</T>
                  )}
                </p>
              </section>

              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-text-primary"><T>Command results</T></h4>
                <div className="overflow-x-auto rounded-xl border border-overlay/10">
                  <table className="w-full text-left text-xs">
                    <thead className="text-text-muted">
                      <tr><th className="px-4 py-2 font-medium"><T>Phase</T></th><th className="px-3 py-2 font-medium"><T>Result</T></th><th className="px-3 py-2 text-right font-medium"><T>Exit</T></th><th className="px-4 py-2 text-right font-medium"><T>Duration</T></th></tr>
                    </thead>
                    <tbody>
                      {([
                        ['Install', data.phases.install],
                        ['Detection after install', data.phases.detectionAfterInstall],
                        ['Uninstall', data.phases.uninstall],
                        ['Detection after uninstall', data.phases.detectionAfterUninstall],
                      ] as const).map(([name, result]) => {
                        const status = phaseStatus(name, result);
                        return (
                          <tr key={name} className="border-t border-overlay/5 text-text-secondary">
                            <td className="px-4 py-2"><T>{name}</T></td>
                            <td className={status.passed === true ? 'px-3 py-2 text-status-success' : status.passed === false ? 'px-3 py-2 text-status-error' : 'px-3 py-2 text-text-muted'}><T>{status.label}</T></td>
                            <td className="px-3 py-2 text-right font-mono">{result?.exitCode ?? '—'}</td>
                            <td className="px-4 py-2 text-right font-mono">{formatQaDuration(result?.durationSeconds)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {data.changes ? (
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-text-primary"><T>Observed system changes</T></h4>
                  <ChangeTable title="Changes after installation" changes={data.changes.afterInstall} />
                  <ChangeTable title="Residual changes after uninstall" changes={data.changes.residualAfterUninstall} />
                  <p className="text-xs leading-relaxed text-text-muted"><T>Counts are correlated with the test window, not attributed to the app; background Windows activity is included. A nonzero residual does not mean the uninstall was dirty.</T></p>
                </section>
              ) : null}

              {data.classification ? (
                <section className="rounded-xl border border-status-warning/20 bg-status-warning/10 p-4">
                  <h4 className="text-sm font-semibold text-status-warning"><T>Automated heuristic — not a verified root cause</T></h4>
                  <p className="mt-2 text-sm text-text-primary">{data.classification.bucket.replace('_', ' ')} · {data.classification.confidence} confidence</p>
                  <p className="mt-1 text-xs text-text-secondary">{data.classification.evidence}</p>
                  <p className="mt-2 text-xs text-text-secondary">{data.classification.remediation}</p>
                </section>
              ) : null}

              <section className="grid gap-3 rounded-xl border border-overlay/10 bg-bg-elevated/50 p-4 text-xs text-text-secondary sm:grid-cols-2">
                <div><span className="block text-text-muted"><T>Execution context</T></span><code>{data.environment?.executionContext || <T>Not recorded</T>}</code></div>
                <div><span className="block text-text-muted"><T>Relevant Windows events</T></span>{data.relevantEventCount ?? <T>Not recorded</T>}</div>
                <div><span className="block text-text-muted"><T>PSADT package profile</T></span><code>{data.package?.profileSha256?.slice(0, 12) || <T>Not recorded</T>}</code></div>
                <div><span className="block text-text-muted"><T>Packager commit</T></span><code>{data.package?.packagerCommit?.slice(0, 12) || <T>Not recorded</T>}</code></div>
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
