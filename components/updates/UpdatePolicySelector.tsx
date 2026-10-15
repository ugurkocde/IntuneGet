'use client';

import { T } from "gt-next";
import { useState } from 'react';
import {
  RefreshCw,
  Bell,
  BellOff,
  Pin,
  ChevronDown,
  Check,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { AutoUpdateScope, UpdatePolicyType } from '@/types/update-policies';

interface UpdatePolicySelectorProps {
  currentPolicy?: UpdatePolicyType | null;
  currentScope?: AutoUpdateScope;
  onPolicyChange: (policyType: UpdatePolicyType, scope?: AutoUpdateScope) => Promise<void>;
  disabled?: boolean;
  size?: 'sm' | 'default';
  showLabel?: boolean;
}

const policyOptions: {
  type: UpdatePolicyType;
  label: string;
  description: string;
  icon: typeof RefreshCw;
  color: string;
  bgColor: string;
  group: 'active' | 'passive';
}[] = [
  {
    type: 'auto_update',
    label: 'Auto-update',
    description: 'Deploy new versions automatically',
    icon: RefreshCw,
    color: 'text-status-success',
    bgColor: 'bg-status-success/10',
    group: 'active',
  },
  {
    type: 'notify',
    label: 'Notify only',
    description: 'Show updates, require manual trigger',
    icon: Bell,
    color: 'text-accent-cyan',
    bgColor: 'bg-accent-cyan/10',
    group: 'active',
  },
  {
    type: 'ignore',
    label: 'Ignore',
    description: 'Hide from updates list',
    icon: BellOff,
    color: 'text-text-muted',
    bgColor: 'bg-overlay/5',
    group: 'passive',
  },
  {
    type: 'pin_version',
    label: 'Pin version',
    description: 'Lock to current deployed version',
    icon: Pin,
    color: 'text-status-warning',
    bgColor: 'bg-status-warning/10',
    group: 'passive',
  },
];

export function UpdatePolicySelector({
  currentPolicy,
  currentScope = 'all',
  onPolicyChange,
  disabled = false,
  size = 'default',
  showLabel = true,
}: UpdatePolicySelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const selectedOption = policyOptions.find((o) => o.type === currentPolicy) || policyOptions[1];

  const handleSelect = async (policyType: UpdatePolicyType) => {
    if (policyType === currentPolicy) return;

    setIsUpdating(true);
    try {
      await onPolicyChange(policyType);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleScope = async (scope: AutoUpdateScope) => {
    if (scope === currentScope) return;
    setIsUpdating(true);
    try { await onPolicyChange('auto_update', scope); }
    finally { setIsUpdating(false); }
  };

  const activeOptions = policyOptions.filter((o) => o.group === 'active');
  const passiveOptions = policyOptions.filter((o) => o.group === 'passive');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled || isUpdating}
          className={cn(
            'text-text-secondary hover:text-text-primary hover:bg-overlay/5 transition-all',
            size === 'sm' && 'h-8 px-2 text-sm'
          )}
        >
          {isUpdating ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <div className={cn('w-5 h-5 rounded flex items-center justify-center mr-1.5', selectedOption.bgColor)}>
                <selectedOption.icon
                  className={cn('w-3 h-3', selectedOption.color)}
                />
              </div>
              {showLabel && (
                <span className="text-[13px]"><T>{selectedOption.label}</T></span>
              )}
              <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-40" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 bg-bg-elevated border-overlay/10 shadow-soft-lg p-1"
      >
        {activeOptions.map((option) => (
          <DropdownMenuItem
            key={option.type}
            onClick={() => handleSelect(option.type)}
            className={cn(
              'flex items-start gap-2.5 p-2.5 cursor-pointer rounded-md',
              'hover:bg-overlay/5 focus:bg-overlay/5',
              option.type === currentPolicy && 'bg-overlay/[0.03]'
            )}
          >
            <div className={cn('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5', option.bgColor)}>
              <option.icon className={cn('w-3.5 h-3.5', option.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  <T>{option.label}</T>
                </span>
                {option.type === currentPolicy && (
                  <Check className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                <T>{option.description}</T>
              </p>
            </div>
          </DropdownMenuItem>
        ))}

        {currentPolicy === 'auto_update' && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1 text-xs text-text-muted">Automatic update scope</p>
            {([['all', 'All updates'], ['minor', 'Minor and major'], ['major', 'Major only']] as const).map(([scope, label]) => (
              <DropdownMenuItem key={scope} disabled={disabled || isUpdating} onClick={() => handleScope(scope)}>
                {label}{scope === currentScope && <Check className="ml-auto h-4 w-4" aria-label="Selected" />}
              </DropdownMenuItem>
            ))}
            {currentScope === 'major' && <p className="px-2 py-1 text-xs text-status-warning">Major only can delay security fixes shipped in minor or patch releases.</p>}
          </>
        )}
        <DropdownMenuSeparator className="bg-overlay/[0.06] my-1" />

        {passiveOptions.map((option) => (
          <DropdownMenuItem
            key={option.type}
            onClick={() => handleSelect(option.type)}
            className={cn(
              'flex items-start gap-2.5 p-2.5 cursor-pointer rounded-md',
              'hover:bg-overlay/5 focus:bg-overlay/5',
              option.type === currentPolicy && 'bg-overlay/[0.03]'
            )}
          >
            <div className={cn('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5', option.bgColor)}>
              <option.icon className={cn('w-3.5 h-3.5', option.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-primary">
                  <T>{option.label}</T>
                </span>
                {option.type === currentPolicy && (
                  <Check className="w-3.5 h-3.5 text-status-success flex-shrink-0" />
                )}
              </div>
              <p className="text-[11px] text-text-muted mt-0.5 leading-relaxed">
                <T>{option.description}</T>
              </p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
