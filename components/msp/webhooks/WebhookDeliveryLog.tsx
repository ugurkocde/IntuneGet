'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface WebhookDelivery {
  id: string;
  event_type: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  response_status: number | null;
  error_message: string | null;
  created_at: string;
  delivered_at: string | null;
}

interface WebhookDeliveryLogProps {
  webhookId: string;
  webhookName: string;
  onBack: () => void;
}

export function WebhookDeliveryLog({ webhookId, webhookName, onBack }: WebhookDeliveryLogProps) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  const { data, isLoading, error } = useQuery<{ deliveries: WebhookDelivery[] }>({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch(`/api/msp/webhooks/${webhookId}/deliveries?limit=50`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch deliveries');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!webhookId,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-accent-cyan animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-400">Failed to load delivery history</p>
      </div>
    );
  }

  const deliveries = data?.deliveries || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="p-1">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h3 className="text-lg font-medium text-text-primary">Delivery History</h3>
          <p className="text-sm text-text-muted">{webhookName}</p>
        </div>
      </div>

      {deliveries.length === 0 ? (
        <div className="p-8 text-center">
          <Clock className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-secondary">No deliveries yet</p>
          <p className="text-xs text-text-muted mt-1">
            Deliveries will appear here when events are triggered
          </p>
        </div>
      ) : (
        <div className="border border-black/10 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-black/5 text-text-muted text-xs uppercase">
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Event</th>
                <th className="px-4 py-3 text-left">Attempts</th>
                <th className="px-4 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="hover:bg-black/5 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {delivery.status === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : delivery.status === 'failed' ? (
                        <XCircle className="w-4 h-4 text-red-400" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-400" />
                      )}
                      <span
                        className={cn(
                          'text-xs font-medium capitalize',
                          delivery.status === 'success' && 'text-emerald-400',
                          delivery.status === 'failed' && 'text-red-400',
                          delivery.status === 'pending' && 'text-amber-400'
                        )}
                      >
                        {delivery.status}
                      </span>
                    </div>
                    {delivery.error_message && (
                      <p className="text-xs text-red-400 mt-1 truncate max-w-[200px]">
                        {delivery.error_message}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-text-primary">{formatEventType(delivery.event_type)}</span>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {delivery.attempts}
                    {delivery.response_status && (
                      <span className="ml-1 text-xs">
                        (HTTP {delivery.response_status})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {formatRelativeTime(delivery.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatEventType(eventType: string): string {
  return eventType
    .split('.')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
