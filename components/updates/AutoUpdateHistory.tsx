'use client';

import { T } from "gt-next";
import { useState, useMemo } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Zap,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fadeUp } from '@/lib/animations/variants';
import type { AutoUpdateHistoryWithPolicy } from '@/types/update-policies';

interface AutoUpdateHistoryProps {
  history: AutoUpdateHistoryWithPolicy[];
  isLoading?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

const statusConfig: Record<
  string,
  {
    icon: typeof Clock;
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
    animate?: boolean;
  }
> = {
  pending: {
    icon: Clock,
    color: 'text-text-muted',
    bgColor: 'bg-overlay/[0.06]',
    borderColor: 'border-l-overlay/20',
    label: 'Pending',
  },
  packaging: {
    icon: Loader2,
    color: 'text-accent-cyan',
    bgColor: 'bg-accent-cyan/10',
    borderColor: 'border-l-accent-cyan',
    label: 'Packaging',
    animate: true,
  },
  deploying: {
    icon: Loader2,
    color: 'text-accent-violet',
    bgColor: 'bg-accent-violet/10',
    borderColor: 'border-l-accent-violet',
    label: 'Deploying',
    animate: true,
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
    borderColor: 'border-l-status-success',
    label: 'Completed',
  },
  failed: {
    icon: XCircle,
    color: 'text-status-error',
    bgColor: 'bg-status-error/10',
    borderColor: 'border-l-status-error',
    label: 'Failed',
  },
  cancelled: {
    icon: XCircle,
    color: 'text-text-muted',
    bgColor: 'bg-overlay/[0.06]',
    borderColor: 'border-l-overlay/20',
    label: 'Cancelled',
  },
};

const updateTypeLabels: Record<string, string> = {
  patch: 'Patch',
  minor: 'Minor',
  major: 'Major',
};

const updateTypeColors: Record<string, string> = {
  patch: 'text-text-muted bg-overlay/[0.04] border-black/[0.08]',
  minor: 'text-accent-cyan bg-accent-cyan/10 border-accent-cyan/20',
  major: 'text-status-warning bg-status-warning/10 border-status-warning/20',
};

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

function getDateGroup(dateString: string): DateGroup {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This Week';
  return 'Older';
}

function groupByDate(
  items: AutoUpdateHistoryWithPolicy[]
): { group: DateGroup; items: AutoUpdateHistoryWithPolicy[] }[] {
  const groups: Map<DateGroup, AutoUpdateHistoryWithPolicy[]> = new Map();
  const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

  for (const item of items) {
    const group = getDateGroup(item.triggered_at);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group)!.push(item);
  }

  return order
    .filter((g) => groups.has(g))
    .map((group) => ({ group, items: groups.get(group)! }));
}

export function AutoUpdateHistory({
  history,
  isLoading,
  onLoadMore,
  hasMore,
}: AutoUpdateHistoryProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const grouped = useMemo(() => groupByDate(history), [history]);

  if (isLoading && history.length === 0) {
    return <AutoUpdateHistorySkeleton />;
  }

  if (history.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 rounded-xl bg-overlay/5 flex items-center justify-center mx-auto mb-3">
          <Clock className="w-6 h-6 text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-secondary mb-1"><T>No update history yet</T></p>
        <p className="text-xs text-text-muted"><T>Updates you trigger or auto-updates will appear here</T></p>
      </div>
    );
  }

  let globalIndex = 0;

  return (
    <div className="space-y-8">
      {grouped.map(({ group, items }) => (
        <div key={group}>
          {/* Date group heading with count badge */}
          <div className="flex items-center gap-3 mb-3 pl-1">
            <Calendar className="w-3.5 h-3.5 text-text-muted" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              <T>{group}</T>
            </h3>
            <span className="text-[10px] font-medium text-text-muted bg-overlay/[0.06] px-1.5 py-0.5 rounded-md tabular-nums">
              {items.length}
            </span>
            <div className="flex-1 h-px bg-black/[0.06]" />
          </div>

          {/* Timeline items */}
          <div className="relative">
            {/* Vertical connecting line */}
            <div className="absolute left-[7px] top-4 bottom-4 w-[1.5px] bg-gradient-to-b from-black/[0.08] via-black/[0.06] to-transparent" />

            <div className="space-y-2">
              {items.map((item) => {
                const status = statusConfig[item.status];
                const isExpanded = expandedId === item.id;
                const StatusIcon = status.icon;
                const currentIndex = globalIndex++;

                return (
                  <motion.div
                    key={item.id}
                    variants={shouldReduceMotion ? undefined : fadeUp}
                    initial={shouldReduceMotion ? { opacity: 1 } : 'hidden'}
                    animate={shouldReduceMotion ? { opacity: 1 } : 'visible'}
                    transition={shouldReduceMotion ? undefined : { delay: currentIndex * 0.03 }}
                    className="relative pl-6"
                  >
                    {/* Timeline dot */}
                    <div className={cn(
                      'absolute left-0 top-[18px] w-[15px] h-[15px] rounded-full border-2 border-bg-elevated flex items-center justify-center z-10',
                      status.bgColor
                    )}>
                      <div className={cn(
                        'w-[7px] h-[7px] rounded-full',
                        item.status === 'completed' ? 'bg-status-success' :
                        item.status === 'failed' ? 'bg-status-error' :
                        item.status === 'packaging' ? 'bg-accent-cyan' :
                        item.status === 'deploying' ? 'bg-accent-violet' :
                        'bg-text-muted'
                      )} />
                    </div>

                    {/* Card */}
                    <div className={cn(
                      'glass-light rounded-lg border border-black/[0.08] overflow-hidden transition-all duration-200',
                      isExpanded && 'border-black/[0.12] shadow-soft'
                    )}>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="w-full flex items-center justify-between p-3.5 text-left hover:bg-overlay/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Status Icon */}
                          <StatusIcon
                            className={cn(
                              'w-4 h-4 flex-shrink-0',
                              status.color,
                              status.animate && 'animate-spin'
                            )}
                          />

                          {/* App Info */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-text-primary truncate">
                                {item.display_name || item.policy.winget_id}
                              </span>
                              <span
                                className={cn(
                                  'px-1.5 py-0.5 text-[10px] font-semibold rounded border uppercase tracking-wide flex-shrink-0',
                                  updateTypeColors[item.update_type]
                                )}
                              >
                                {updateTypeLabels[item.update_type]}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono">
                              <span className="truncate">{item.from_version}</span>
                              <ArrowRight className="w-3 h-3 flex-shrink-0 text-text-muted/50" />
                              <span className="truncate">{item.to_version}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                          {/* Status label + Timestamp */}
                          <div className="text-right">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md',
                                status.color, status.bgColor
                              )}
                            >
                              {status.label}
                            </span>
                            <p className="text-[11px] text-text-muted mt-0.5 tabular-nums">
                              {formatTime(item.triggered_at)}
                            </p>
                          </div>

                          {/* Expand Arrow */}
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <ChevronDown className="w-4 h-4 text-text-muted" />
                          </motion.div>
                        </div>
                      </button>

                      {/* Expanded Content */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            animate={shouldReduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                            exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="px-3.5 pb-3.5 pt-0 border-t border-black/[0.06]">
                              <div className="mt-3 bg-overlay/[0.02] rounded-lg p-3.5 grid grid-cols-2 gap-3">
                                <div>
                                  <span className="text-text-muted text-[11px] font-medium uppercase tracking-wide"><T>Winget ID</T></span>
                                  <p className="text-text-primary font-mono text-xs mt-0.5 truncate">
                                    {item.policy.winget_id}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-text-muted text-[11px] font-medium uppercase tracking-wide"><T>Tenant</T></span>
                                  <p className="text-text-primary font-mono text-xs mt-0.5 truncate">
                                    {item.policy.tenant_id}
                                  </p>
                                </div>
                                <div>
                                  <span className="text-text-muted text-[11px] font-medium uppercase tracking-wide"><T>Triggered</T></span>
                                  <p className="text-text-primary text-xs mt-0.5">
                                    {new Date(item.triggered_at).toLocaleString()}
                                  </p>
                                </div>
                                {item.completed_at && (
                                  <div>
                                    <span className="text-text-muted text-[11px] font-medium uppercase tracking-wide"><T>Completed</T></span>
                                    <p className="text-text-primary text-xs mt-0.5">
                                      {new Date(item.completed_at).toLocaleString()}
                                    </p>
                                  </div>
                                )}
                              </div>

                              {item.error_message && (
                                <div className="mt-2.5 p-3 bg-status-error/[0.06] border border-status-error/20 rounded-lg">
                                  <p className="text-xs text-status-error font-mono leading-relaxed">
                                    {item.error_message}
                                  </p>
                                </div>
                              )}

                              {item.packaging_job_id && (
                                <div className="mt-2.5">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-text-muted hover:text-text-primary h-7 text-xs"
                                    asChild
                                  >
                                    <a
                                      href={`/dashboard/uploads?jobs=${item.packaging_job_id}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <T>View Job Details</T>
                                      <ExternalLink className="w-3 h-3 ml-1.5" />
                                    </a>
                                  </Button>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </div>
      ))}

      {/* Load More */}
      {hasMore && (
        <div className="text-center pt-2">
          <Button
            variant="ghost"
            onClick={onLoadMore}
            disabled={isLoading}
            className="text-text-muted hover:text-text-primary text-sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                <T>Loading...</T>
              </>
            ) : (
              <T>Load More</T>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function AutoUpdateHistorySkeleton() {
  return (
    <div className="space-y-8">
      {/* Group 1 */}
      <div>
        <div className="flex items-center gap-3 mb-3 pl-1">
          <div className="w-3.5 h-3.5 bg-overlay/[0.06] rounded animate-pulse" />
          <div className="h-3 w-12 bg-overlay/[0.06] rounded animate-pulse" />
          <div className="h-4 w-5 bg-overlay/[0.04] rounded-md animate-pulse" />
          <div className="flex-1 h-px bg-black/[0.06]" />
        </div>
        <div className="relative">
          <div className="absolute left-[7px] top-4 bottom-4 w-[1.5px] bg-black/[0.06]" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={`g1-${i}`} className="relative pl-6">
                <div className="absolute left-0 top-[18px] w-[15px] h-[15px] rounded-full bg-overlay/[0.06] animate-pulse" />
                <div className="glass-light rounded-lg border border-black/[0.08] p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 bg-overlay/[0.06] rounded-full animate-pulse flex-shrink-0" />
                    <div className="flex-1">
                      <div className="h-4 w-32 bg-overlay/[0.08] rounded-md animate-pulse mb-1.5" />
                      <div className="h-3 w-24 bg-overlay/[0.05] rounded-md animate-pulse" />
                    </div>
                    <div className="text-right">
                      <div className="h-5 w-16 bg-overlay/[0.06] rounded-md animate-pulse mb-1" />
                      <div className="h-3 w-12 bg-overlay/[0.05] rounded-md animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Group 2 */}
      <div>
        <div className="flex items-center gap-3 mb-3 pl-1">
          <div className="w-3.5 h-3.5 bg-overlay/[0.06] rounded animate-pulse" />
          <div className="h-3 w-16 bg-overlay/[0.06] rounded animate-pulse" />
          <div className="h-4 w-5 bg-overlay/[0.04] rounded-md animate-pulse" />
          <div className="flex-1 h-px bg-black/[0.06]" />
        </div>
        <div className="relative">
          <div className="absolute left-[7px] top-4 bottom-4 w-[1.5px] bg-black/[0.06]" />
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={`g2-${i}`} className="relative pl-6">
                <div className="absolute left-0 top-[18px] w-[15px] h-[15px] rounded-full bg-overlay/[0.06] animate-pulse" />
                <div className="glass-light rounded-lg border border-black/[0.08] p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 bg-overlay/[0.06] rounded-full animate-pulse flex-shrink-0" />
                    <div className="flex-1">
                      <div className="h-4 w-32 bg-overlay/[0.08] rounded-md animate-pulse mb-1.5" />
                      <div className="h-3 w-24 bg-overlay/[0.05] rounded-md animate-pulse" />
                    </div>
                    <div className="text-right">
                      <div className="h-5 w-16 bg-overlay/[0.06] rounded-md animate-pulse mb-1" />
                      <div className="h-3 w-12 bg-overlay/[0.05] rounded-md animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
