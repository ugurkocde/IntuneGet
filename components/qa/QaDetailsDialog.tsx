'use client';

import { AlertTriangle, CheckCircle2, Clock3, Loader2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { useQaDetails } from '@/hooks/use-qa';
import { QA_CHANGE_CATEGORIES, type QaChangeSet, type QaPhaseResult } from '@/types/qa';

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

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

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

function ChangeTable({ title, changes }: { title: string; changes: QaChangeSet }) {
  return (
    <details className="rounded-xl border border-overlay/10 bg-bg-elevated/50" open={title === 'Changes after installation'}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-cyan">
        {title}
      </summary>
      <div className="overflow-x-auto border-t border-overlay/10">
        <table className="w-full text-left text-xs">
          <thead className="text-text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Area</th>
              <th className="px-3 py-2 text-right font-medium">Added</th>
              <th className="px-3 py-2 text-right font-medium">Updated</th>
              <th className="px-4 py-2 text-right font-medium">Removed</th>
            </tr>
          </thead>
          <tbody>
            {QA_CHANGE_CATEGORIES.map((category) => (
              <tr key={category} className="border-t border-overlay/5 text-text-secondary">
                <td className="px-4 py-2">{CATEGORY_LABELS[category]}</td>
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>PSADT package QA details</DialogTitle>
          <DialogDescription>Latest isolated test of the package IntuneGet deploys through Intune.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 p-6">
          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading QA result…
            </div>
          ) : isError || !data ? (
            <div className="rounded-xl border border-status-error/20 bg-status-error/10 p-4 text-sm text-status-error">
              The QA result could not be loaded. Please try again.
            </div>
          ) : (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-text-primary">{data.displayName}</h3>
                    <p className="text-sm text-text-secondary">
                      Version {data.testedVersion} · {data.architecture} · {data.publisher}
                    </p>
                  </div>
                  <StatusBadge
                    tone={data.outcome === 'Passed' ? 'success' : 'error'}
                    icon={data.outcome === 'Passed' ? CheckCircle2 : XCircle}
                  >
                    QA {data.outcome}
                  </StatusBadge>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
                  <span>{new Date(data.testedAtUtc).toLocaleString()}</span>
                  <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatDuration(data.overallDurationSeconds)}</span>
                  <span>{data.installerType?.toUpperCase() || 'Installer type unknown'}</span>
                  <span>PSADT {data.package?.psadtVersion || 'version unknown'}</span>
                </div>
              </section>

              {data.testedVersion !== catalogVersion ? (
                <div className="flex gap-2 rounded-xl border border-status-warning/20 bg-status-warning/10 p-3 text-sm text-status-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>This result is for version {data.testedVersion}; the catalog now offers {catalogVersion}. The outcome may not apply to the newer version.</p>
                </div>
              ) : null}

              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-text-primary">Silent installation method</h4>
                <div>
                  <p className="mb-1 text-xs text-text-muted">Install command</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-overlay/10 bg-bg-base p-3 text-xs text-text-secondary">{data.commands.install}</pre>
                </div>
                <div>
                  <p className="mb-1 text-xs text-text-muted">Uninstall command</p>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-overlay/10 bg-bg-base p-3 text-xs text-text-secondary">{data.commands.uninstall}</pre>
                </div>
                <p className="text-xs text-text-secondary">
                  {data.detection.type === 'fileVersion' ? (
                    <>Detection: file version at <code className="rounded bg-bg-base px-1 py-0.5">{data.detection.path}</code> must be at least {data.detection.minimumVersion}.</>
                  ) : (
                    <>Detection: {data.detection.description}.</>
                  )}
                </p>
              </section>

              <section className="space-y-3">
                <h4 className="text-sm font-semibold text-text-primary">Command results</h4>
                <div className="overflow-x-auto rounded-xl border border-overlay/10">
                  <table className="w-full text-left text-xs">
                    <thead className="text-text-muted">
                      <tr><th className="px-4 py-2 font-medium">Phase</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 text-right font-medium">Exit</th><th className="px-4 py-2 text-right font-medium">Duration</th></tr>
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
                            <td className="px-4 py-2">{name}</td>
                            <td className={status.passed === true ? 'px-3 py-2 text-status-success' : status.passed === false ? 'px-3 py-2 text-status-error' : 'px-3 py-2 text-text-muted'}>{status.label}</td>
                            <td className="px-3 py-2 text-right font-mono">{result?.exitCode ?? '—'}</td>
                            <td className="px-4 py-2 text-right font-mono">{formatDuration(result?.durationSeconds)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {data.changes ? (
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold text-text-primary">Observed system changes</h4>
                  <ChangeTable title="Changes after installation" changes={data.changes.afterInstall} />
                  <ChangeTable title="Residual changes after uninstall" changes={data.changes.residualAfterUninstall} />
                  <p className="text-xs leading-relaxed text-text-muted">Counts are correlated with the test window, not attributed to the app; background Windows activity is included. A nonzero residual does not mean the uninstall was dirty.</p>
                </section>
              ) : null}

              {data.classification ? (
                <section className="rounded-xl border border-status-warning/20 bg-status-warning/10 p-4">
                  <h4 className="text-sm font-semibold text-status-warning">Automated heuristic — not a verified root cause</h4>
                  <p className="mt-2 text-sm text-text-primary">{data.classification.bucket.replace('_', ' ')} · {data.classification.confidence} confidence</p>
                  <p className="mt-1 text-xs text-text-secondary">{data.classification.evidence}</p>
                  <p className="mt-2 text-xs text-text-secondary">{data.classification.remediation}</p>
                </section>
              ) : null}

              <section className="grid gap-3 rounded-xl border border-overlay/10 bg-bg-elevated/50 p-4 text-xs text-text-secondary sm:grid-cols-2">
                <div><span className="block text-text-muted">Execution context</span><code>{data.environment?.executionContext || 'Not recorded'}</code></div>
                <div><span className="block text-text-muted">Relevant Windows events</span>{data.relevantEventCount ?? 'Not recorded'}</div>
                <div><span className="block text-text-muted">PSADT package profile</span><code>{data.package?.profileSha256?.slice(0, 12) || 'Not recorded'}</code></div>
                <div><span className="block text-text-muted">Packager commit</span><code>{data.package?.packagerCommit?.slice(0, 12) || 'Not recorded'}</code></div>
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
