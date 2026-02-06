'use client';

import { useState, useEffect } from 'react';
import {
  Webhook,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Trash2,
  Send,
  Edit2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { WebhookFormModal } from './WebhookFormModal';
import type { WebhookConfiguration, WebhookType } from '@/types/notifications';

interface WebhookManagerProps {
  className?: string;
}

const WEBHOOK_TYPE_LABELS: Record<WebhookType, { label: string; color: string }> = {
  slack: { label: 'Slack', color: 'text-[#4A154B] bg-[#4A154B]/10' },
  teams: { label: 'Teams', color: 'text-[#6264A7] bg-[#6264A7]/10' },
  discord: { label: 'Discord', color: 'text-[#5865F2] bg-[#5865F2]/10' },
  custom: { label: 'Custom', color: 'text-text-secondary bg-black/5' },
};

export function WebhookManager({ className }: WebhookManagerProps) {
  const { getAccessToken } = useMicrosoftAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [webhooks, setWebhooks] = useState<WebhookConfiguration[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookConfiguration | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch webhooks
  useEffect(() => {
    fetchWebhooks();
  }, []);

  async function fetchWebhooks() {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch('/api/webhooks', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setWebhooks(data.webhooks);
      }
    } catch (err) {
      console.error('Failed to fetch webhooks:', err);
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreateWebhook = async (data: {
    name: string;
    url: string;
    webhook_type: WebhookType;
    secret?: string;
    headers?: Record<string, string>;
  }) => {
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication required');

      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create webhook');
      }

      const result = await response.json();
      setWebhooks([result.webhook, ...webhooks]);
      setIsModalOpen(false);
    } catch (err) {
      throw err;
    }
  };

  const handleUpdateWebhook = async (data: {
    name: string;
    url: string;
    webhook_type: WebhookType;
    secret?: string;
    headers?: Record<string, string>;
  }) => {
    if (!editingWebhook) return;

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Authentication required');

      const response = await fetch(`/api/webhooks/${editingWebhook.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update webhook');
      }

      const result = await response.json();
      setWebhooks(webhooks.map((w) => (w.id === editingWebhook.id ? result.webhook : w)));
      setEditingWebhook(null);
      setIsModalOpen(false);
    } catch (err) {
      throw err;
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) return;

    setDeletingId(id);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`/api/webhooks/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setWebhooks(webhooks.filter((w) => w.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleWebhook = async (webhook: WebhookConfiguration) => {
    setTogglingId(webhook.id);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`/api/webhooks/${webhook.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_enabled: !webhook.is_enabled }),
      });

      if (response.ok) {
        const result = await response.json();
        setWebhooks(webhooks.map((w) => (w.id === webhook.id ? result.webhook : w)));
      }
    } catch (err) {
      console.error('Failed to toggle webhook:', err);
    } finally {
      setTogglingId(null);
    }
  };

  const handleTestWebhook = async (id: string) => {
    setTestingId(id);
    setTestResults((prev) => ({ ...prev, [id]: { success: false, message: 'Testing...' } }));

    try {
      const token = await getAccessToken();
      if (!token) return;

      const response = await fetch(`/api/webhooks/${id}/test`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (result.success) {
        setTestResults((prev) => ({
          ...prev,
          [id]: { success: true, message: 'Test successful!' },
        }));
        // Refresh webhooks to get updated status
        fetchWebhooks();
      } else {
        setTestResults((prev) => ({
          ...prev,
          [id]: { success: false, message: result.error || 'Test failed' },
        }));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: false, message: 'Failed to send test' },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const openEditModal = (webhook: WebhookConfiguration) => {
    setEditingWebhook(webhook);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingWebhook(null);
  };

  if (isLoading) {
    return (
      <div className={cn('glass-light rounded-xl p-6 border border-black/5', className)}>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('glass-light rounded-xl p-6 border border-black/5 hover:border-accent-violet/20 transition-colors', className)}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-violet/10 flex items-center justify-center">
            <Webhook className="w-5 h-5 text-accent-violet" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Webhook Notifications</h2>
            <p className="text-sm text-text-secondary">Send updates to Slack, Teams, or Discord</p>
          </div>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          disabled={webhooks.length >= 10}
          size="sm"
          className="bg-accent-violet hover:bg-accent-violet/80 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Webhook
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-black/5 flex items-center justify-center">
            <Webhook className="w-6 h-6 text-text-muted" />
          </div>
          <p className="text-text-secondary mb-2">No webhooks configured</p>
          <p className="text-sm text-text-muted">
            Add a webhook to receive notifications in Slack, Teams, or Discord
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((webhook) => (
            <div
              key={webhook.id}
              className={cn(
                'p-4 rounded-lg border transition-colors',
                webhook.is_enabled
                  ? 'bg-bg-elevated border-black/5'
                  : 'bg-bg-surface border-black/5 opacity-60'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-text-primary truncate">{webhook.name}</h3>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-xs font-medium',
                        WEBHOOK_TYPE_LABELS[webhook.webhook_type].color
                      )}
                    >
                      {WEBHOOK_TYPE_LABELS[webhook.webhook_type].label}
                    </span>
                    {webhook.failure_count >= 5 && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-status-error/10 text-status-error">
                        Failing
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-text-muted font-mono truncate mb-2">{webhook.url}</p>

                  <div className="flex items-center gap-4 text-xs text-text-muted">
                    {webhook.last_success_at && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-status-success" />
                        Last success: {new Date(webhook.last_success_at).toLocaleDateString()}
                      </span>
                    )}
                    {webhook.failure_count > 0 && (
                      <span className="flex items-center gap-1 text-status-warning">
                        <AlertTriangle className="w-3 h-3" />
                        {webhook.failure_count} failures
                      </span>
                    )}
                  </div>

                  {/* Test result */}
                  {testResults[webhook.id] && (
                    <div
                      className={cn(
                        'mt-2 text-xs flex items-center gap-1',
                        testResults[webhook.id].success
                          ? 'text-status-success'
                          : 'text-status-error'
                      )}
                    >
                      {testResults[webhook.id].success ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      {testResults[webhook.id].message}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 ml-4">
                  {/* Test button */}
                  <button
                    onClick={() => handleTestWebhook(webhook.id)}
                    disabled={testingId === webhook.id || !webhook.is_enabled}
                    className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors disabled:opacity-50"
                    title="Send test"
                  >
                    {testingId === webhook.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => openEditModal(webhook)}
                    className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {/* Toggle button */}
                  <button
                    onClick={() => handleToggleWebhook(webhook)}
                    disabled={togglingId === webhook.id}
                    className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors disabled:opacity-50"
                    title={webhook.is_enabled ? 'Disable' : 'Enable'}
                  >
                    {togglingId === webhook.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : webhook.is_enabled ? (
                      <ToggleRight className="w-4 h-4 text-status-success" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteWebhook(webhook.id)}
                    disabled={deletingId === webhook.id}
                    className="p-2 rounded-lg text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    {deletingId === webhook.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {webhooks.length >= 10 && (
        <p className="text-xs text-text-muted mt-4 text-center">
          Maximum of 10 webhooks reached
        </p>
      )}

      {/* Modal */}
      <WebhookFormModal
        isOpen={isModalOpen}
        onClose={closeModal}
        onSubmit={editingWebhook ? handleUpdateWebhook : handleCreateWebhook}
        initialData={editingWebhook}
      />
    </div>
  );
}

export default WebhookManager;
