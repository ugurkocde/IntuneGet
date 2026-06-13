'use client';

import { T, Var } from "gt-next";
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  AlertTriangle,
  RefreshCw,
  XCircle,
  Clock,
  Bell,
  BellOff,
  Pin,
  ChevronRight,
  Zap,
  Plus,
  ShieldOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { UpdatePolicySelector } from './UpdatePolicySelector';
import { cn } from '@/lib/utils';
import { classifyUpdateType } from '@/types/update-policies';
import { fadeUp, springPresets } from '@/lib/animations/variants';
import type { AvailableUpdate, UpdatePolicyType } from '@/types/update-policies';

interface UpdateCardProps {
  update: AvailableUpdate;
  onTriggerUpdate: (update: AvailableUpdate) => Promise<void>;
  onPolicyChange: (update: AvailableUpdate, policyType: UpdatePolicyType) => Promise<void>;
  onDismiss?: (update: AvailableUpdate) => void;
  isUpdating?: boolean;
  index?: number;
}

const policyIcons: Record<string, typeof RefreshCw> = {
  auto_update: RefreshCw,
  notify: Bell,
  ignore: BellOff,
  pin_version: Pin,
};

const policyLabels: Record<string, string> = {
  auto_update: 'Auto',
  notify: 'Notify',
  ignore: 'Ignore',
  pin_version: 'Pinned',
};

const policyColors: Record<string, string> = {
  auto_update: 'text-status-success bg-status-success/10 border-status-success/20',
  notify: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20',
  ignore: 'text-text-muted bg-overlay/5 border-overlay/10',
  pin_version: 'text-status-warning bg-status-warning/10 border-status-warning/20',
};

const updateTypeConfig: Record<string, { label: string; color: string; bgColor: string; borderColor: string; dotColor: string }> = {
  patch: {
    label: 'Patch',
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
    borderColor: 'border-status-success/20',
    dotColor: 'bg-status-success',
  },
  minor: {
    label: 'Minor',
    color: 'text-accent-cyan',
    bgColor: 'bg-accent-cyan/10',
    borderColor: 'border-accent-cyan/20',
    dotColor: 'bg-accent-cyan',
  },
  major: {
    label: 'Major',
    color: 'text-status-warning',
    bgColor: 'bg-status-warning/10',
    borderColor: 'border-status-warning/20',
    dotColor: 'bg-status-warning',
  },
};

export function UpdateCard({
  update,
  onTriggerUpdate,
  onPolicyChange,
  onDismiss,
  isUpdating = false,
  index = 0,
}: UpdateCardProps) {
  const shouldReduceMotion = useReducedMotion();

  const handlePolicyChange = async (policyType: UpdatePolicyType) => {
    await onPolicyChange(update, policyType);
  };

  const policyStatus = update.policy;
  const isAutoUpdateEnabled =
    policyStatus?.policy_type === 'auto_update' && policyStatus?.is_enabled;
  const hasFailures = (policyStatus?.consecutive_failures || 0) > 0;
  const updateType = classifyUpdateType(update.current_version, update.latest_version);
  const typeConfig = updateTypeConfig[updateType];
  const PolicyIcon = policyStatus?.policy_type ? policyIcons[policyStatus.policy_type] : null;

  // Calculate how old the detected update is
  const detectedDaysAgo = Math.floor(
    (Date.now() - new Date(update.detected_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <motion.div
      variants={shouldReduceMotion ? undefined : fadeUp}
      initial={shouldReduceMotion ? { opacity: 1 } : 'hidden'}
      animate={shouldReduceMotion ? { opacity: 1 } : 'visible'}
      transition={shouldReduceMotion ? undefined : { delay: index * 0.04 }}
      whileHover={shouldReduceMotion ? undefined : { y: -2, transition: springPresets.snappy }}
      className={cn(
        'glass-light rounded-xl border transition-all duration-200 relative group overflow-hidden',
        update.is_critical
          ? 'border-l-[3px] border-l-status-warning border-t-status-warning/15 border-r-status-warning/15 border-b-status-warning/15'
          : !update.has_prior_deployment
            ? 'border-l-[3px] border-l-violet-500 border-t-violet-500/15 border-r-violet-500/15 border-b-violet-500/15'
            : 'border-black/[0.08] hover:border-accent-cyan/20 hover:shadow-soft-md'
      )}
    >
      {/* Subtle gradient overlay on hover */}
      <div className={cn(
        'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none',
        update.is_critical
          ? 'bg-gradient-to-br from-status-warning/[0.03] via-transparent to-transparent'
          : !update.has_prior_deployment
            ? 'bg-gradient-to-br from-violet-500/[0.03] via-transparent to-transparent'
            : 'bg-gradient-to-br from-accent-cyan/[0.03] via-transparent to-transparent'
      )} />

      {/* Main content */}
      <div className="relative p-5">
        {/* Top row: Icon, name, badges */}
        <div className="flex items-start gap-3 mb-3.5">
          {/* App Icon with subtle ring */}
          <div className="relative flex-shrink-0">
            <AppIcon
              packageId={update.winget_id}
              packageName={update.display_name}
              size="lg"
            />
            {/* Failure indicator overlaid on icon */}
            {hasFailures && (
              <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-status-error border-2 border-bg-elevated shadow-[0_0_6px_rgba(239,68,68,0.4)]" />
            )}
          </div>

          {/* Name, ID, and badges */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-sm font-semibold text-text-primary truncate">
                {update.display_name}
              </h3>
              {update.is_critical && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold text-status-warning bg-status-warning/10 border border-status-warning/20 rounded-md flex-shrink-0 uppercase tracking-wide">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  <T>Critical</T>
                </span>
              )}
              {!update.is_managed && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold text-accent-violet bg-accent-violet/10 border border-accent-violet/20 rounded-md flex-shrink-0 uppercase tracking-wide"
                  title="Matched automatically; not managed by IntuneGet. Update with care -- excluded from Update All."
                >
                  <ShieldOff className="w-2.5 h-2.5" />
                  <T>Unmanaged</T>
                </span>
              )}
            </div>
            <span className="text-xs font-mono text-text-muted leading-none">{update.winget_id}</span>
          </div>

          {/* Policy badge */}
          {policyStatus?.policy_type && PolicyIcon && (
            <span
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border flex-shrink-0',
                policyColors[policyStatus.policy_type] || 'text-text-muted bg-overlay/5 border-overlay/10'
              )}
            >
              <PolicyIcon className="w-3 h-3" />
              {policyLabels[policyStatus.policy_type]}
            </span>
          )}
        </div>

        {/* Version comparison - redesigned as a horizontal flow */}
        <div className="flex items-center gap-2 mb-3.5 px-0.5">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {/* Current version */}
            <span className="px-2.5 py-1 text-[13px] font-mono bg-overlay/[0.04] text-text-secondary border border-black/[0.08] rounded-md truncate">
              {update.current_version}
            </span>

            {/* Arrow with type indicator */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className={cn('h-px w-3', typeConfig.dotColor, 'opacity-40')} />
              <span className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-md border',
                typeConfig.color, typeConfig.bgColor, typeConfig.borderColor
              )}>
                <ChevronRight className="w-2.5 h-2.5" />
                {typeConfig.label}
              </span>
              <div className={cn('h-px w-3', typeConfig.dotColor, 'opacity-40')} />
            </div>

            {/* New version */}
            <span className={cn(
              'px-2.5 py-1 text-[13px] font-mono rounded-md border font-semibold truncate',
              typeConfig.bgColor, typeConfig.color, typeConfig.borderColor
            )}>
              {update.latest_version}
            </span>
          </div>
        </div>

        {/* Status metadata line */}
        <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
          {!update.has_prior_deployment && update.is_managed && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-violet-500">
              <Plus className="w-3 h-3" />
              <T>New to IntuneGet</T>
            </span>
          )}
          {isAutoUpdateEnabled && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-status-success">
              <Zap className="w-3 h-3" />
              <T>Auto-update</T>
            </span>
          )}
          {hasFailures && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-status-error">
              <XCircle className="w-3 h-3" />
              {policyStatus?.consecutive_failures} <T>failed</T>
            </span>
          )}
          {policyStatus?.last_auto_update_at && (
            <span className="flex items-center gap-1 text-[11px] text-text-muted">
              <Clock className="w-3 h-3" />
              <T>Last:</T> {new Date(policyStatus.last_auto_update_at).toLocaleDateString()}
            </span>
          )}
          {detectedDaysAgo > 0 && !policyStatus?.last_auto_update_at && !hasFailures && !isAutoUpdateEnabled && (
            <span className="flex items-center gap-1 text-[11px] text-text-muted">
              <Clock className="w-3 h-3" />
              <T>Detected <Var>{detectedDaysAgo === 1 ? '1 day' : `${detectedDaysAgo} days`}</Var> ago</T>
            </span>
          )}
        </div>

        {/* Action row */}
        <div className="flex items-center justify-between pt-3 border-t border-black/[0.06]">
          <UpdatePolicySelector
            currentPolicy={policyStatus?.policy_type || null}
            onPolicyChange={handlePolicyChange}
            size="sm"
            showLabel={false}
          />

          <Button
            size="sm"
            onClick={() => onTriggerUpdate(update)}
            disabled={isUpdating}
            className={cn(
              'font-medium text-[13px] h-8 px-3.5',
              isUpdating
                ? 'bg-accent-cyan/50 text-bg-deepest/70'
                : 'bg-accent-cyan hover:bg-accent-cyan-bright text-bg-deepest shadow-sm hover:shadow-glow-cyan transition-shadow'
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isUpdating ? (
                <motion.span
                  key="updating"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <T>Updating...</T>
                </motion.span>
              ) : (
                <motion.span
                  key="update"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5"
                >
                  <T>Update</T>
                  <ArrowRight className="w-3.5 h-3.5" />
                </motion.span>
              )}
            </AnimatePresence>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

interface UpdateCardSkeletonProps {
  count?: number;
}

export function UpdateCardSkeleton({ count = 3 }: UpdateCardSkeletonProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="glass-light rounded-xl border border-black/[0.08] overflow-hidden"
        >
          <div className="p-5">
            {/* Top row */}
            <div className="flex items-start gap-3 mb-3.5">
              <div className="w-12 h-12 bg-overlay/[0.06] rounded-xl animate-pulse flex-shrink-0" />
              <div className="flex-1">
                <div className="h-4 w-36 bg-overlay/[0.08] rounded-md animate-pulse mb-2" />
                <div className="h-3 w-24 bg-overlay/[0.05] rounded-md animate-pulse" />
              </div>
              <div className="h-6 w-14 bg-overlay/[0.06] rounded-lg animate-pulse" />
            </div>

            {/* Version row */}
            <div className="flex items-center gap-2 mb-3.5">
              <div className="h-7 w-20 bg-overlay/[0.05] rounded-md animate-pulse" />
              <div className="h-5 w-14 bg-overlay/[0.05] rounded-md animate-pulse" />
              <div className="h-7 w-20 bg-overlay/[0.05] rounded-md animate-pulse" />
            </div>

            {/* Status line */}
            <div className="h-3 w-28 bg-overlay/[0.04] rounded-md animate-pulse mb-3.5" />

            {/* Bottom row */}
            <div className="flex items-center justify-between pt-3 border-t border-black/[0.06]">
              <div className="h-8 w-8 bg-overlay/[0.06] rounded-md animate-pulse" />
              <div className="h-8 w-20 bg-overlay/[0.06] rounded-md animate-pulse" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
