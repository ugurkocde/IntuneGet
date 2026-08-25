'use client';

import { T } from 'gt-next';
import { RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { UpdatePolicySelector } from '@/components/updates/UpdatePolicySelector';
import type { AppUpdatePolicy, UpdatePolicyType } from '@/types/update-policies';

interface AutoUpdateAppsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policies: AppUpdatePolicy[];
  onPolicyChange: (policy: AppUpdatePolicy, policyType: UpdatePolicyType) => Promise<void>;
}

// Lists every app with auto-update enabled for the selected tenant. These
// apps are not necessarily in the Available list (an up-to-date app has no
// pending update), so the stat card opens this dedicated view.
export function AutoUpdateAppsModal({ open, onOpenChange, policies, onPolicyChange }: AutoUpdateAppsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-bg-surface border-overlay/10 max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-status-success" />
            <T>Auto-Update Enabled</T>
          </DialogTitle>
          <DialogDescription>
            <T>These apps are updated automatically when a new version is available.</T>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-1 px-1">
          {policies.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-8">
              <T>No apps have auto-update enabled for this tenant yet. Choose Auto-update for an app during deployment or from its update card.</T>
            </p>
          ) : (
            <ul className="space-y-2">
              {policies.map((policy) => (
                <li
                  key={policy.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-overlay/10 bg-bg-elevated/50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {policy.deployment_config?.displayName || policy.winget_id}
                    </p>
                    <p className="text-xs font-mono text-text-muted truncate">{policy.winget_id}</p>
                  </div>
                  <UpdatePolicySelector
                    currentPolicy={policy.policy_type}
                    onPolicyChange={(type) => onPolicyChange(policy, type)}
                    size="sm"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
