'use client';

import {
  Check,
  ClipboardCheck,
  FileArchive,
  Loader2,
  PackageCheck,
  RotateCcw,
  SearchCheck,
  Send,
  ShieldCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { T, Var } from 'gt-next';
import { getQaPhasePresentation } from '@/lib/qa/presentation';
import { cn } from '@/lib/utils';
import type { QaLivePhase } from '@/types/qa';

interface TimelineStep {
  phase: Exclude<QaLivePhase, 'queued'>;
  label: string;
  description: string;
  tasks: string[];
  Icon: LucideIcon;
}

const STEPS: TimelineStep[] = [
  {
    phase: 'scanning_installer',
    label: 'Security scan',
    description: 'Check the verified installer hash against the VirusTotal database.',
    tasks: ['Query 70+ security vendors by SHA-256', 'Record the reputation verdict'],
    Icon: ShieldCheck,
  },
  {
    phase: 'preparing_package',
    label: 'Prepare the package',
    description: 'Download the verified installer and build the exact PSADT package.',
    tasks: ['Validate the installer source', 'Apply the selected PSADT configuration'],
    Icon: FileArchive,
  },
  {
    phase: 'restoring_vm',
    label: 'Restore the clean VM',
    description: 'Revert to the golden checkpoint and start an isolated Windows session.',
    tasks: ['Revert the golden checkpoint', 'Connect through PowerShell Direct'],
    Icon: RotateCcw,
  },
  {
    phase: 'installing',
    label: 'Install the application',
    description: 'Transfer the package and run it in the configured security context.',
    tasks: ['Launch the PSADT package', 'Observe installer and system activity'],
    Icon: PackageCheck,
  },
  {
    phase: 'detecting_install',
    label: 'Verify installation',
    description: 'Apply the exact Intune detection rule to the installed application.',
    tasks: ['Evaluate the detection rule', 'Capture installed-state evidence'],
    Icon: SearchCheck,
  },
  {
    phase: 'uninstalling',
    label: 'Remove the application',
    description: 'Run the packaged silent uninstall path and capture its result.',
    tasks: ['Resolve the registered uninstall command', 'Run unattended removal'],
    Icon: Trash2,
  },
  {
    phase: 'verifying_removal',
    label: 'Verify removal',
    description: 'Confirm the app is no longer detected and compare residual changes.',
    tasks: ['Re-run detection', 'Compare files and registry changes'],
    Icon: ClipboardCheck,
  },
  {
    phase: 'publishing',
    label: 'Publish the result',
    description: 'Sanitize the evidence, save the compact result, and clean the test VM.',
    tasks: ['Write the QA result', 'Restore the clean checkpoint'],
    Icon: Send,
  },
];

export function QaLiveStepTimeline({
  phase,
  className,
}: {
  phase: QaLivePhase;
  className?: string;
}) {
  const phasePresentation = getQaPhasePresentation(phase);
  const activeIndex = STEPS.findIndex((step) => step.phase === phase);

  return (
    <section
      className={cn(
        'flex min-h-[36rem] flex-col rounded-xl border border-overlay/10 bg-bg-surface/45 p-4 sm:p-5',
        className
      )}
      aria-labelledby="qa-test-progress-heading"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 id="qa-test-progress-heading" className="text-base font-semibold text-text-primary">
            <T>Test progress</T>
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            <T>Live tasks inside the isolated Windows VM</T>
          </p>
        </div>
        <span className="rounded-full bg-accent-cyan/10 px-2.5 py-1 text-xs font-medium text-accent-cyan">
          <T>Step <Var>{phasePresentation.step}</Var> of <Var>{phasePresentation.totalSteps}</Var></T>
        </span>
      </div>

      <ol className="min-h-0 flex-1" aria-label="QA test steps">
        {STEPS.map((step, index) => {
          const isComplete = activeIndex >= 0 && index < activeIndex;
          const isActive = index === activeIndex;
          const isUpcoming = !isComplete && !isActive;
          const StepIcon = step.Icon;

          return (
            <li
              key={step.phase}
              className={cn('flex gap-3 transition-opacity duration-500', isUpcoming && 'opacity-45')}
              aria-current={isActive ? 'step' : undefined}
            >
              <div className="flex w-9 shrink-0 flex-col items-center">
                <span
                  className={cn(
                    'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all duration-500',
                    isComplete && 'border-status-success bg-status-success text-white',
                    isActive && 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan shadow-[0_0_0_5px_rgba(6,182,212,0.08)]',
                    isUpcoming && 'border-overlay/25 text-text-muted'
                  )}
                  aria-hidden="true"
                >
                  {isActive ? (
                    <>
                      <span className="absolute inset-0 animate-ping rounded-full border border-accent-cyan/40 motion-reduce:animate-none" />
                      <span className="animate-spin motion-reduce:animate-none">
                        <Loader2 className="h-4 w-4" />
                      </span>
                    </>
                  ) : isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <StepIcon className="h-4 w-4" />
                  )}
                </span>
                {index < STEPS.length - 1 ? (
                  <span
                    className={cn(
                      'my-1 min-h-4 w-px flex-1 transition-colors duration-500',
                      isComplete ? 'bg-status-success' : isActive ? 'bg-gradient-to-b from-accent-cyan to-overlay/15' : 'bg-overlay/15'
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              <div
                className={cn(
                  'mb-2 min-w-0 flex-1 rounded-xl border px-3 py-2.5 transition-all duration-500',
                  isActive ? 'border-accent-cyan/25 bg-accent-cyan/[0.05]' : 'border-transparent'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                      <T>Step <Var>{index + 1}</Var></T>
                    </p>
                    <p className={cn('mt-0.5 text-sm font-medium', isUpcoming ? 'text-text-muted' : 'text-text-primary')}>
                      <T>{step.label}</T>
                    </p>
                  </div>
                  <span className={cn('shrink-0 text-[10px] font-medium', isComplete ? 'text-status-success' : isActive ? 'text-accent-cyan' : 'text-text-muted')}>
                    <T>{isComplete ? 'Complete' : isActive ? 'In progress' : 'Waiting'}</T>
                  </span>
                </div>

                {isActive ? (
                  <div className="mt-2.5 space-y-2" aria-live="polite">
                    <p className="text-xs leading-relaxed text-text-secondary"><T>{step.description}</T></p>
                    <ul className="space-y-1.5">
                      {step.tasks.map((task) => (
                        <li key={task} className="flex items-center gap-2 text-[11px] text-text-muted">
                          <span className="h-1 w-1 shrink-0 rounded-full bg-accent-cyan" aria-hidden="true" />
                          <T>{task}</T>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
