'use client';

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { EventTypeSelector } from './EventTypeSelector';
import { Button } from '@/components/ui/button';
import {
  X,
  Loader2,
  Webhook,
  Copy,
  Check,
} from 'lucide-react';

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  event_types: string[];
  headers: Record<string, string>;
  is_enabled: boolean;
}

interface MspWebhookFormModalProps {
  webhook?: WebhookConfig | null;
  isOpen: boolean;
  onClose: () => void;
}

export function MspWebhookFormModal({ webhook, isOpen, onClose }: MspWebhookFormModalProps) {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [generateSecret, setGenerateSecret] = useState(true);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!webhook;

  useEffect(() => {
    if (webhook) {
      setName(webhook.name);
      setUrl(webhook.url);
      setEventTypes(webhook.event_types);
      setGenerateSecret(false);
    } else {
      setName('');
      setUrl('');
      setEventTypes([]);
      setGenerateSecret(true);
    }
    setNewSecret(null);
    setError(null);
  }, [webhook, isOpen]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/msp/webhooks', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          url,
          event_types: eventTypes,
          generate_secret: generateSecret,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create webhook');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      if (data.webhook?.secret) {
        setNewSecret(data.webhook.secret);
      } else {
        onClose();
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch(`/api/msp/webhooks/${webhook!.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          url,
          event_types: eventTypes,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update webhook');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to update webhook');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !url.trim() || eventTypes.length === 0) {
      setError('Please fill in all required fields');
      return;
    }

    if (isEditing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const handleCopySecret = () => {
    if (newSecret) {
      navigator.clipboard.writeText(newSecret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (!isOpen) return null;

  // Show secret after creation
  if (newSecret) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-md bg-bg-surface border border-white/10 rounded-xl shadow-2xl">
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Check className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-lg font-medium text-text-primary">Webhook Created</h3>
            </div>

            <p className="text-sm text-text-secondary">
              Your webhook has been created. Please save the secret below - it will not be shown again.
            </p>

            <div className="p-4 rounded-lg bg-black/20 border border-white/10">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-text-muted uppercase">Signing Secret</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopySecret}
                  className="text-xs"
                >
                  {secretCopied ? (
                    <>
                      <Check className="w-3 h-3 mr-1" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <code className="block text-sm text-accent-cyan font-mono break-all">
                {newSecret}
              </code>
            </div>

            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-bg-surface border border-white/10 rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-white/10 bg-bg-surface">
          <div className="flex items-center gap-3">
            <Webhook className="w-5 h-5 text-accent-cyan" />
            <h3 className="text-lg font-medium text-text-primary">
              {isEditing ? 'Edit Webhook' : 'New Webhook'}
            </h3>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Webhook"
              className="w-full px-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Endpoint URL *
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full px-4 py-2 rounded-lg border border-black/10 bg-transparent text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-cyan"
            />
            <p className="text-xs text-text-muted mt-1">Must use HTTPS</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Events *
            </label>
            <EventTypeSelector
              selectedTypes={eventTypes}
              onChange={setEventTypes}
            />
          </div>

          {!isEditing && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="generateSecret"
                checked={generateSecret}
                onChange={(e) => setGenerateSecret(e.target.checked)}
                className="rounded border-black/10 accent-accent-cyan"
              />
              <label htmlFor="generateSecret" className="text-sm text-text-secondary">
                Generate signing secret (recommended)
              </label>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="bg-gradient-to-r from-accent-cyan to-accent-violet"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEditing ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                isEditing ? 'Save Changes' : 'Create Webhook'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
