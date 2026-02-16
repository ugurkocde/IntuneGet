'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Check, Loader2, Clock, XCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PROGRESS_STAGES,
  getCurrentStage,
  getCompletedStages,
} from '@/lib/progress-stages';
import { useElapsedTime } from '@/hooks/use-elapsed-time';

interface ProgressStepperProps {
  progress: number;
  status: string;
  statusMessage?: string;
  startTime?: string | null;
  endTime?: string | null;
  errorStage?: string | null;
}

export function ProgressStepper({
  progress,
  status,
  statusMessage,
  startTime,
  endTime,
  errorStage,
}: ProgressStepperProps) {
  const prefersReducedMotion = useReducedMotion();
  const currentStage = getCurrentStage(progress, status, errorStage);
  const completedStages = getCompletedStages(progress, status, errorStage);
  const { formattedTime } = useElapsedTime({
    startTime: startTime || null,
    endTime: endTime || null,
  });

  const isJobFailed = status === 'failed';
  const isJobCompleted = ['completed', 'deployed'].includes(status);
  const isActive = !isJobFailed && !isJobCompleted;

  return (
    <div className="mt-5 space-y-3">
      {/* Stage Stepper - Two Row Layout */}
      <div className="space-y-2">
        {/* Row 1: Circles and connector lines */}
        <div className="flex items-center">
          {PROGRESS_STAGES.map((stage, index) => {
            const isCompleted = completedStages.includes(stage.id as never);
            const isCurrent = currentStage?.id === stage.id;
            const isFailedStage = isJobFailed && isCurrent;
            const isPending = !isCompleted && !isCurrent;

            return (
              <div key={stage.id} className="flex items-center flex-1 last:flex-none">
                {/* Stage Circle */}
                <motion.div
                  initial={prefersReducedMotion ? {} : { scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={
                    !prefersReducedMotion && isCompleted
                      ? { type: 'spring', stiffness: 400, damping: 15 }
                      : { duration: prefersReducedMotion ? 0 : 0.3 }
                  }
                  title={stage.description}
                  className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300 shadow-sm flex-shrink-0',
                    isFailedStage && 'bg-status-error/20 border-2 border-status-error',
                    isJobCompleted && 'bg-status-success/20 border-2 border-status-success',
                    !isJobFailed && !isJobCompleted && isCompleted && 'bg-status-success/20 border-2 border-status-success',
                    !isJobFailed && !isJobCompleted && isCurrent && 'bg-accent-cyan/20 border-2 border-accent-cyan',
                    isJobFailed && isCompleted && !isCurrent && 'bg-status-success/20 border-2 border-status-success',
                    isPending && !isJobCompleted && !isJobFailed && 'bg-bg-elevated border-2 border-overlay/10',
                    isPending && isJobFailed && 'bg-bg-elevated border-2 border-overlay/10',
                    isCurrent && !isJobFailed && !isJobCompleted && !prefersReducedMotion && 'animate-ring-pulse'
                  )}
                >
                  {isFailedStage ? (
                    <XCircle className="w-[18px] h-[18px] text-status-error" />
                  ) : isJobCompleted || isCompleted ? (
                    <Check className="w-[18px] h-[18px] text-status-success" />
                  ) : isCurrent ? (
                    <Loader2 className="w-[18px] h-[18px] text-accent-cyan animate-spin" aria-label="Processing" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-text-muted" />
                  )}
                </motion.div>

                {/* Connector Line */}
                {index < PROGRESS_STAGES.length - 1 && (
                  <div className="flex-1 mx-1.5 h-[3px] overflow-hidden rounded-full bg-overlay/[0.08]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: isCompleted || isJobCompleted ? '100%' : '0%'
                      }}
                      transition={{
                        duration: prefersReducedMotion ? 0 : 0.5,
                        ease: 'easeOut'
                      }}
                      className={cn(
                        'h-full',
                        isCompleted || isJobCompleted
                          ? 'bg-status-success/60'
                          : 'bg-transparent'
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Row 2: Labels grid */}
        <div className="grid grid-cols-7">
          {PROGRESS_STAGES.map((stage) => {
            const isCompleted = completedStages.includes(stage.id as never);
            const isCurrent = currentStage?.id === stage.id;
            const isFailedStage = isJobFailed && isCurrent;
            const isPending = !isCompleted && !isCurrent;

            return (
              <span
                key={stage.id}
                className={cn(
                  'text-xs font-medium transition-colors text-center',
                  isFailedStage && 'text-status-error',
                  isJobFailed && isCompleted && !isCurrent && 'text-status-success',
                  (isJobCompleted || isCompleted) && !isJobFailed && 'text-status-success',
                  isCurrent && !isJobFailed && !isJobCompleted && 'text-accent-cyan',
                  isPending && !isJobCompleted && 'text-text-muted'
                )}
              >
                {stage.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* Status Message and Time */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {isActive && !prefersReducedMotion && (
            <span className="w-2 h-2 rounded-full bg-accent-cyan animate-pulse flex-shrink-0" />
          )}
          <span className={cn(
            isJobFailed
              ? 'text-status-error'
              : isActive
                ? 'font-medium text-text-primary'
                : 'text-text-secondary'
          )}>
            {isJobCompleted
              ? <span className="text-status-success font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Completed
                </span>
              : isJobFailed
                ? (statusMessage?.replace(/^\[test:\d+\/\d+\]\s*/, '') || 'Failed')
                : (statusMessage?.replace(/^\[test:\d+\/\d+\]\s*/, '') || currentStage?.description || 'Processing...')}
          </span>
        </div>
        <div className="flex items-center gap-2 text-text-muted">
          {isJobCompleted ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
          ) : (
            <Clock className="w-3.5 h-3.5" />
          )}
          <span className="tabular-nums">{formattedTime}</span>
        </div>
      </div>

      {/* Progress Bar with inline percentage - hidden for failed jobs */}
      {!isJobFailed && (
        <div className="flex items-center gap-2">
          <div className={cn(
            'flex-1 h-2.5 rounded-full overflow-hidden shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]',
            isJobCompleted ? 'bg-status-success/10' : 'bg-bg-elevated'
          )}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{
                duration: prefersReducedMotion ? 0 : 0.5,
                ease: 'easeOut'
              }}
              className={cn(
                'h-full rounded-full',
                isJobCompleted
                  ? 'bg-status-success shadow-glow-success'
                  : 'bg-gradient-to-r from-accent-cyan to-accent-violet'
              )}
            />
          </div>
          <span className={cn(
            'text-xs font-medium tabular-nums w-10 text-right flex-shrink-0',
            isJobCompleted ? 'text-status-success' : 'text-text-secondary'
          )}>
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}
