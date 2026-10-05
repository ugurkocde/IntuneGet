'use client';

import { Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CartItem, Win32CartItem } from '@/types/upload';
import type { CuratedSettingsStatus } from '@/types/curated-verification';

interface Props {
  items: CartItem[];
  statuses?: CuratedSettingsStatus[];
  unavailable: boolean;
  checking: boolean;
  onRetry: () => void;
  onDefaults: (itemId: string, config: Win32CartItem['psadtConfig']) => void;
}

export function CuratedSettingsNotice({ items, statuses, unavailable, checking, onRetry, onDefaults }: Props) {
  return (
    <div role="status" className="flex max-h-56 overflow-y-auto items-start gap-3 p-3 bg-accent-cyan/10 border border-accent-cyan/20 rounded-lg">
      {checking ? <Loader2 className="w-5 h-5 text-accent-cyan shrink-0 mt-0.5 animate-spin" />
        : <Clock className="w-5 h-5 text-accent-cyan shrink-0 mt-0.5" />}
      <div className="min-w-0 text-sm space-y-2">
        <p className="text-accent-cyan font-medium">{unavailable ? 'Settings check unavailable' : 'Deployment settings verification'}</p>
        <p className="text-text-secondary">
          {unavailable ? 'We could not check these settings. Retry the check before deploying.'
            : 'Custom settings are tested automatically before deployment. This cart updates when they are ready.'}
        </p>
        {items.map(item => {
          const state = statuses?.find(status => status.itemId === item.id);
          if (state?.status === 'ready') return null;
          const label = !state ? 'Checking settings…' : state.status === 'requested' ? 'Queued for verification'
            : state.status === 'verifying' ? 'Verification running' : state.status === 'failed' ? 'Settings need review'
            : 'Settings unavailable';
          return <div key={item.id} className="space-y-1">
            <p className="text-text-primary">{item.displayName}: <span className="text-text-secondary">{label}</span></p>
            {state?.status === 'failed' && <p className="text-text-secondary">Edit these settings or use the tested defaults.</p>}
            {state?.status === 'unavailable' && !state.defaultConfig && <p className="text-text-secondary">Select this app from the Curated Catalog again to review its available release.</p>}
            {state?.defaultConfig && <Button size="sm" variant="outline" onClick={() => onDefaults(item.id, state.defaultConfig!)}>
              Use tested defaults
            </Button>}
          </div>;
        })}
        {unavailable && <Button size="sm" variant="outline" disabled={checking} onClick={onRetry}>Retry settings check</Button>}
      </div>
    </div>
  );
}
