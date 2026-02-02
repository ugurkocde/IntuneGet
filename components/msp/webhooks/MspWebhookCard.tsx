'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { Button } from '@/components/ui/button';
import {
  Webhook,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  MoreVertical,
  Trash2,
  PlayCircle,
  Pencil,
  Power,
  Loader2,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  headers: Record<string, string>;
  is_enabled: boolean;
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  created_by_email: string;
}

interface MspWebhookCardProps {
  webhook: WebhookConfig;
  onEdit: (webhook: WebhookConfig) => void;
  onViewDeliveries: (webhook: WebhookConfig) => void;
}

export function MspWebhookCard({ webhook, onEdit, onViewDeliveries }: MspWebhookCardProps) {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();
  const [showMenu, setShowMenu] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const toggleMutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch(`/api/msp/webhooks/${webhook.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_enabled: !webhook.is_enabled }),
      });

      if (!response.ok) {
        throw new Error('Failed to toggle webhook');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch(`/api/msp/webhooks/${webhook.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete webhook');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch(`/api/msp/webhooks/${webhook.id}/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to test webhook');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setTestResult(data);
      setTimeout(() => setTestResult(null), 5000);
    },
    onError: () => {
      setTestResult({ success: false, message: 'Failed to send test' });
      setTimeout(() => setTestResult(null), 5000);
    },
  });

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete this webhook?')) {
      deleteMutation.mutate();
    }
    setShowMenu(false);
  };

  const getStatusIndicator = () => {
    if (!webhook.is_enabled) {
      return { color: 'text-text-muted', label: 'Disabled', icon: Power };
    }
    if (webhook.failure_count >= 3) {
      return { color: 'text-red-400', label: 'Failing', icon: AlertTriangle };
    }
    if (webhook.last_success_at) {
      return { color: 'text-emerald-400', label: 'Active', icon: CheckCircle2 };
    }
    return { color: 'text-amber-400', label: 'Pending', icon: Clock };
  };

  const status = getStatusIndicator();
  const StatusIcon = status.icon;

  return (
    <div
      className={cn(
        'p-4 rounded-xl glass-light border transition-all',
        !webhook.is_enabled ? 'border-black/5 opacity-60' : 'border-black/5 hover:border-black/10'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('p-2 rounded-lg', webhook.is_enabled ? 'bg-accent-cyan/10' : 'bg-black/5')}>
            <Webhook className={cn('w-5 h-5', webhook.is_enabled ? 'text-accent-cyan' : 'text-text-muted')} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text-primary truncate">{webhook.name}</h3>
            <p className="text-xs text-text-muted truncate">{webhook.url}</p>
          </div>
        </div>

        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMenu(!showMenu)}
            className="p-1"
          >
            <MoreVertical className="w-4 h-4" />
          </Button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-40 bg-bg-surface border border-white/10 rounded-lg shadow-lg z-20 py-1">
                <button
                  onClick={() => { onEdit(webhook); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-black/5"
                >
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
                <button
                  onClick={() => { toggleMutation.mutate(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-black/5"
                >
                  <Power className="w-4 h-4" />
                  {webhook.is_enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => { onViewDeliveries(webhook); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-primary hover:bg-black/5"
                >
                  <Clock className="w-4 h-4" />
                  View Deliveries
                </button>
                <hr className="my-1 border-white/10" />
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status and events */}
      <div className="flex items-center gap-3 mb-3">
        <span className={cn('flex items-center gap-1 text-xs', status.color)}>
          <StatusIcon className="w-3 h-3" />
          {status.label}
        </span>
        <span className="text-xs text-text-muted">
          {webhook.event_types.length} event{webhook.event_types.length !== 1 ? 's' : ''}
        </span>
        {webhook.last_success_at && (
          <span className="text-xs text-text-muted">
            Last: {formatRelativeTime(webhook.last_success_at)}
          </span>
        )}
      </div>

      {/* Test button and result */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || !webhook.is_enabled}
          className="border-black/20 text-xs"
        >
          {testMutation.isPending ? (
            <>
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <PlayCircle className="w-3 h-3 mr-1" />
              Test
            </>
          )}
        </Button>

        {testResult && (
          <span className={cn('text-xs flex items-center gap-1', testResult.success ? 'text-emerald-400' : 'text-red-400')}>
            {testResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {testResult.message}
          </span>
        )}
      </div>
    </div>
  );
}
