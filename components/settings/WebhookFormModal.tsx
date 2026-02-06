'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WebhookConfiguration, WebhookType } from '@/types/notifications';

interface WebhookFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    url: string;
    webhook_type: WebhookType;
    secret?: string;
    headers?: Record<string, string>;
  }) => Promise<void>;
  initialData?: WebhookConfiguration | null;
}

const WEBHOOK_TYPES: { value: WebhookType; label: string; placeholder: string }[] = [
  {
    value: 'slack',
    label: 'Slack',
    placeholder: 'https://hooks.slack.com/services/...',
  },
  {
    value: 'teams',
    label: 'Microsoft Teams',
    placeholder: 'https://webhook.office.com/webhookb2/...',
  },
  {
    value: 'discord',
    label: 'Discord',
    placeholder: 'https://discord.com/api/webhooks/...',
  },
  {
    value: 'custom',
    label: 'Custom',
    placeholder: 'https://your-endpoint.com/webhook',
  },
];

export function WebhookFormModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}: WebhookFormModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    url: '',
    webhook_type: 'slack' as WebhookType,
    secret: '',
    headers: [] as { key: string; value: string }[],
  });

  // Reset form when modal opens/closes or initial data changes
  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setFormData({
          name: initialData.name,
          url: initialData.url,
          webhook_type: initialData.webhook_type,
          secret: '', // Don't show existing secret
          headers: Object.entries(initialData.headers || {}).map(([key, value]) => ({
            key,
            value,
          })),
        });
      } else {
        setFormData({
          name: '',
          url: '',
          webhook_type: 'slack',
          secret: '',
          headers: [],
        });
      }
      setError(null);
      setShowSecret(false);
    }
  }, [isOpen, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      // Validate
      if (!formData.name.trim()) {
        throw new Error('Name is required');
      }
      if (!formData.url.trim()) {
        throw new Error('URL is required');
      }

      // Convert headers array to object
      const headers: Record<string, string> = {};
      formData.headers.forEach(({ key, value }) => {
        if (key.trim()) {
          headers[key.trim()] = value;
        }
      });

      await onSubmit({
        name: formData.name.trim(),
        url: formData.url.trim(),
        webhook_type: formData.webhook_type,
        secret: formData.secret || undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save webhook');
    } finally {
      setIsSubmitting(false);
    }
  };

  const addHeader = () => {
    setFormData({
      ...formData,
      headers: [...formData.headers, { key: '', value: '' }],
    });
  };

  const removeHeader = (index: number) => {
    setFormData({
      ...formData,
      headers: formData.headers.filter((_, i) => i !== index),
    });
  };

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...formData.headers];
    newHeaders[index] = { ...newHeaders[index], [field]: value };
    setFormData({ ...formData, headers: newHeaders });
  };

  const selectedType = WEBHOOK_TYPES.find((t) => t.value === formData.webhook_type);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-bg-elevated border border-black/10 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black/5">
          <h2 className="text-lg font-semibold text-text-primary">
            {initialData ? 'Edit Webhook' : 'Add Webhook'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Name
            </label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Slack Webhook"
              className="bg-bg-elevated border-black/10 text-text-primary"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Type
            </label>
            <div className="grid grid-cols-4 gap-2">
              {WEBHOOK_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() =>
                    setFormData({ ...formData, webhook_type: type.value })
                  }
                  className={cn(
                    'px-3 py-2 rounded-lg border text-sm transition-all',
                    formData.webhook_type === type.value
                      ? 'bg-accent-violet/20 border-accent-violet/50 text-accent-violet'
                      : 'bg-bg-elevated border-black/10 text-text-secondary hover:border-black/20'
                  )}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Webhook URL
            </label>
            <Input
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder={selectedType?.placeholder}
              className="bg-bg-elevated border-black/10 text-text-primary font-mono text-sm"
            />
          </div>

          {/* Secret (optional) */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Secret (optional)
            </label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={formData.secret}
                onChange={(e) =>
                  setFormData({ ...formData, secret: e.target.value })
                }
                placeholder={initialData?.secret ? '(unchanged)' : 'For HMAC signature'}
                className="bg-bg-elevated border-black/10 text-text-primary pr-10 placeholder:text-text-muted"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
              >
                {showSecret ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-text-muted mt-1">
              Used to sign payloads for verification
            </p>
          </div>

          {/* Custom Headers (only for custom type) */}
          {formData.webhook_type === 'custom' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-text-primary">
                  Custom Headers
                </label>
                <Button
                  type="button"
                  onClick={addHeader}
                  size="sm"
                  variant="outline"
                  className="border-black/10 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Header
                </Button>
              </div>

              {formData.headers.length === 0 ? (
                <p className="text-xs text-text-muted">No custom headers</p>
              ) : (
                <div className="space-y-2">
                  {formData.headers.map((header, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={header.key}
                        onChange={(e) => updateHeader(index, 'key', e.target.value)}
                        placeholder="Header name"
                        className="bg-bg-elevated border-black/10 text-text-primary text-sm flex-1"
                      />
                      <Input
                        value={header.value}
                        onChange={(e) => updateHeader(index, 'value', e.target.value)}
                        placeholder="Value"
                        className="bg-bg-elevated border-black/10 text-text-primary text-sm flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeHeader(index)}
                        className="p-2 text-text-muted hover:text-status-error"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-status-error/10 border border-status-error/20 rounded-lg">
              <p className="text-sm text-status-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              className="border-black/10"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="bg-accent-violet hover:bg-accent-violet-bright text-white"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : initialData ? (
                'Update Webhook'
              ) : (
                'Add Webhook'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default WebhookFormModal;
