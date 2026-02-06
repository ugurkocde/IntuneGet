'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Check, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PROGRESS_STAGES,
  getCurrentStage,
  getCompletedStages,
  type ProgressStage,
} from '@/lib/progress-stages';
import { useElapsedTime } from '@/hooks/use-elapsed-time';

interface ProgressStepperProps {
  progress: number;
  status: string;
  statusMessage?: string;
  startTime?: string | null;
  endTime?: string | null;
}

export function ProgressStepper({
  progress,
  status,
  statusMessage,
  startTime,
  endTime,
}: ProgressStepperProps) {
  const prefersReducedMotion = useReducedMotion();
  const currentStage = getCurrentStage(progress, status);
  const completedStages = getCompletedStages(progress);
  const { formattedTime } = useElapsedTime({
    startTime: startTime || null,
    endTime: endTime || null,
  });

  const isJobFailed = status === 'failed';
  const isJobCompleted = ['completed', 'deployed'].includes(status);

  return (
    <div className="mt-4 space-y-4">
      {/* Stage Stepper */}
      <div className="flex items-center justify-between">
        {PROGRESS_STAGES.map((stage, index) => {
          const isCompleted = completedStages.includes(stage.id as never);
          const isCurrent = currentStage?.id === stage.id;
          const isPending = !isCompleted && !isCurrent;

          return (
            <div key={stage.id} className="flex items-center flex-1">
              {/* Stage Circle */}
              <div className="flex flex-col items-center">
                <motion.div
                  initial={prefersReducedMotion ? {} : { scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300',
                    isJobFailed && isCurrent && 'bg-status-error/20 border-2 border-status-error',
                    isJobCompleted && 'bg-status-success/20 border-2 border-status-success',
                    !isJobFailed && !isJobCompleted && isCompleted && 'bg-status-success/20 border-2 border-status-success',
                    !isJobFailed && !isJobCompleted && isCurrent && 'bg-accent-cyan/20 border-2 border-accent-cyan',
                    isPending && !isJobCompleted && 'bg-bg-elevated border-2 border-black/10'
                  )}
                >
                  {isJobFailed && isCurrent ? (
                    <span className="text-status-error text-xs font-bold">!</span>
                  ) : isJobCompleted || isCompleted ? (
                    <Check className="w-4 h-4 text-status-success" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 text-accent-cyan animate-spin" />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-text-muted" />
                  )}
                </motion.div>

                {/* Stage Label */}
                <span
                  className={cn(
                    'mt-2 text-xs font-medium transition-colors',
                    isJobFailed && isCurrent && 'text-status-error',
                    (isJobCompleted || isCompleted) && !isJobFailed && 'text-status-success',
                    isCurrent && !isJobFailed && !isJobCompleted && 'text-accent-cyan',
                    isPending && !isJobCompleted && 'text-text-muted'
                  )}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connector Line */}
              {index < PROGRESS_STAGES.length - 1 && (
                <div className="flex-1 mx-2 h-0.5 mt-[-16px] overflow-hidden rounded-full bg-black/5">
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
                        ? 'bg-status-success/50'
                        : 'bg-transparent'
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Status Message and Time */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">
          {statusMessage || currentStage?.description || 'Processing...'}
        </span>
        <div className="flex items-center gap-2 text-text-muted">
          <Clock className="w-3.5 h-3.5" />
          <span className="tabular-nums">{formattedTime}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{
            duration: prefersReducedMotion ? 0 : 0.5,
            ease: 'easeOut'
          }}
          className={cn(
            'h-full rounded-full',
            isJobFailed
              ? 'bg-status-error'
              : isJobCompleted
              ? 'bg-status-success'
              : 'bg-gradient-to-r from-accent-cyan to-accent-violet'
          )}
        />
      </div>

      {/* Progress Percentage */}
      <div className="text-right">
        <span className={cn(
          'text-xs font-medium tabular-nums',
          isJobFailed ? 'text-status-error' : isJobCompleted ? 'text-status-success' : 'text-text-secondary'
        )}>
          {progress}%
        </span>
      </div>
    </div>
  );
}
