'use client';

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Loader2, XCircle, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TEST_SUBSTEPS,
  parseTestStep,
  getSubStepStatuses,
  type SubStepStatus,
} from '@/lib/test-substeps';

interface TestSubStepperProps {
  statusMessage: string | null | undefined;
  isJobFailed: boolean;
}

export function TestSubStepper({ statusMessage, isJobFailed }: TestSubStepperProps) {
  const prefersReducedMotion = useReducedMotion();

  const activeStep = parseTestStep(statusMessage);
  // Test is complete when we have a message, no [test:N/5] prefix, and the job hasn't failed
  const isTestComplete = !!statusMessage && activeStep === null && !isJobFailed;
  const statuses = getSubStepStatuses(activeStep, isJobFailed, isTestComplete);

  return (
    <motion.div
      initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: prefersReducedMotion ? 0.1 : 0.25 }}
      className={cn(
        'mt-3 ml-2 pl-4 border-l-2 bg-overlay/[0.02] rounded-r-lg',
        isJobFailed ? 'border-status-error/20' : 'border-accent-cyan/20'
      )}
    >
      <div className="space-y-2.5 py-2">
        {TEST_SUBSTEPS.map((step, i) => (
          <SubStepRow
            key={step.id}
            label={step.label}
            description={step.description}
            status={statuses[i]}
            prefersReducedMotion={!!prefersReducedMotion}
          />
        ))}
      </div>
    </motion.div>
  );
}

function SubStepRow({
  label,
  description,
  status,
  prefersReducedMotion,
}: {
  label: string;
  description: string;
  status: SubStepStatus;
  prefersReducedMotion: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {/* Icon circle */}
      <div
        className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200',
          status === 'completed' && 'bg-status-success/20',
          status === 'active' && 'bg-accent-cyan/20',
          status === 'failed' && 'bg-status-error/20',
          status === 'pending' && 'bg-overlay/5',
          status === 'active' && !prefersReducedMotion && 'animate-ring-pulse'
        )}
      >
        {status === 'completed' && (
          <Check className="w-3.5 h-3.5 text-status-success" />
        )}
        {status === 'active' && (
          <Loader2
            className={cn(
              'w-3.5 h-3.5 text-accent-cyan',
              !prefersReducedMotion && 'animate-spin'
            )}
          />
        )}
        {status === 'failed' && (
          <XCircle className="w-3.5 h-3.5 text-status-error" />
        )}
        {status === 'pending' && (
          <Minus className="w-3.5 h-3.5 text-text-muted/50" />
        )}
      </div>

      {/* Label */}
      <span
        className={cn(
          'text-[13px] font-medium transition-colors',
          status === 'completed' && 'text-status-success',
          status === 'active' && 'text-accent-cyan',
          status === 'failed' && 'text-status-error',
          status === 'pending' && 'text-text-muted'
        )}
      >
        {label}
      </span>

      {/* Description (only for active or failed step) */}
      <AnimatePresence>
        {(status === 'active' || status === 'failed') && (
          <motion.span
            initial={prefersReducedMotion ? {} : { opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? {} : { opacity: 0, x: -4 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { type: 'spring', damping: 25, stiffness: 300 }
            }
            className={cn(
              'text-[13px]',
              status === 'active' && 'text-text-secondary',
              status === 'failed' && 'text-status-error/70'
            )}
          >
            {description}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
