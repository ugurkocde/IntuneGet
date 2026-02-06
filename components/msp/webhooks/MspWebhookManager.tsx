'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { MspWebhookCard } from './MspWebhookCard';
import { MspWebhookFormModal } from './MspWebhookFormModal';
import { WebhookDeliveryLog } from './WebhookDeliveryLog';
import { Button } from '@/components/ui/button';
import {
  Webhook,
  Plus,
  Loader2,
  XCircle,
} from 'lucide-react';

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

export function MspWebhookManager() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfig | null>(null);
  const [viewingDeliveries, setViewingDeliveries] = useState<WebhookConfig | null>(null);

  const { data, isLoading, error } = useQuery<{ webhooks: WebhookConfig[] }>({
    queryKey: ['webhooks'],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/msp/webhooks', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch webhooks');
      }

      return response.json();
    },
    enabled: isAuthenticated,
  });

  const handleEdit = (webhook: WebhookConfig) => {
    setEditingWebhook(webhook);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingWebhook(null);
  };

  const webhooks = data?.webhooks || [];

  // Show delivery log view
  if (viewingDeliveries) {
    return (
      <div className="p-6 rounded-xl glass-light border border-black/5">
        <WebhookDeliveryLog
          webhookId={viewingDeliveries.id}
          webhookName={viewingDeliveries.name}
          onBack={() => setViewingDeliveries(null)}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-accent-cyan animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl glass-light border border-red-500/20 text-center">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-400">Failed to load webhooks</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-text-secondary">
            {webhooks.length} of 5 webhooks configured
          </p>
        </div>
        {webhooks.length < 5 && (
          <Button
            onClick={() => setIsFormOpen(true)}
            className="bg-gradient-to-r from-accent-cyan to-accent-violet text-bg-elevated hover:opacity-90"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Webhook
          </Button>
        )}
      </div>

      {/* Webhook list */}
      {webhooks.length === 0 ? (
        <div className="p-8 rounded-xl glass-light border border-black/5 text-center">
          <Webhook className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-secondary mb-4">No webhooks configured</p>
          <p className="text-xs text-text-muted mb-4">
            Webhooks allow you to receive real-time notifications about events in your MSP organization.
          </p>
          <Button
            onClick={() => setIsFormOpen(true)}
            variant="outline"
            size="sm"
            className="border-black/20"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add your first webhook
          </Button>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {webhooks.map((webhook) => (
            <MspWebhookCard
              key={webhook.id}
              webhook={webhook}
              onEdit={handleEdit}
              onViewDeliveries={setViewingDeliveries}
            />
          ))}
        </div>
      )}

      {/* Form modal */}
      <MspWebhookFormModal
        webhook={editingWebhook}
        isOpen={isFormOpen}
        onClose={handleCloseForm}
      />
    </div>
  );
}
