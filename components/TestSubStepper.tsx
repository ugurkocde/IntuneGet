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
      className="mt-3 ml-1 pl-3 border-l-2 border-overlay/10"
    >
      <div className="space-y-1.5 py-1">
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
    <div className="flex items-center gap-2.5">
      {/* Icon circle */}
      <div
        className={cn(
          'w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-200',
          status === 'completed' && 'bg-status-success/20',
          status === 'active' && 'bg-accent-cyan/20',
          status === 'failed' && 'bg-status-error/20',
          status === 'pending' && 'bg-overlay/5'
        )}
      >
        {status === 'completed' && (
          <Check className="w-3 h-3 text-status-success" />
        )}
        {status === 'active' && (
          <Loader2
            className={cn(
              'w-3 h-3 text-accent-cyan',
              !prefersReducedMotion && 'animate-spin'
            )}
          />
        )}
        {status === 'failed' && (
          <XCircle className="w-3 h-3 text-status-error" />
        )}
        {status === 'pending' && (
          <Minus className="w-3 h-3 text-text-muted/50" />
        )}
      </div>

      {/* Label */}
      <span
        className={cn(
          'text-xs font-medium transition-colors',
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
            transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
            className={cn(
              'text-xs',
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
