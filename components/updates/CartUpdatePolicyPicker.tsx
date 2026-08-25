'use client';

import { cn } from '@/lib/utils';

// Cart-time update policy choice. undefined = "Notify" (default): nothing is
// written on deploy, so a policy set earlier on the Updates page is preserved.
// pin_version is intentionally absent; it has no meaning before deployment.
export type CartUpdatePolicyValue = 'auto_update' | 'ignore' | undefined;

interface PolicyOption {
  value: CartUpdatePolicyValue;
  label: string;
  description: string;
}

const POLICY_OPTIONS: PolicyOption[] = [
  {
    value: undefined,
    label: 'Notify',
    description: 'New versions appear on the Updates page and in your notifications. You deploy them when you choose.',
  },
  {
    value: 'auto_update',
    label: 'Auto update',
    description: 'New versions are packaged, checked by QA, and deployed to this tenant automatically. Assignments carry over based on your settings.',
  },
  {
    value: 'ignore',
    label: 'Ignore',
    description: 'Skip update checks for this app. It will not appear on the Updates page.',
  },
];

interface CartUpdatePolicyPickerProps {
  value: CartUpdatePolicyValue;
  onChange: (value: CartUpdatePolicyValue) => void;
}

export function CartUpdatePolicyPicker({ value, onChange }: CartUpdatePolicyPickerProps) {
  const selected = POLICY_OPTIONS.find((option) => option.value === value) ?? POLICY_OPTIONS[0];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {POLICY_OPTIONS.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors',
              selected.label === option.label
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-bg-elevated border-overlay/15 text-text-primary hover:border-overlay/20'
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-text-muted">{selected.description}</p>
      <p className="text-xs text-text-muted">
        Applies after this deployment completes. You can change it anytime on the Updates page.
      </p>
    </div>
  );
}
