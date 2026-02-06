'use client';

import { useState, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import type {
  NotificationPreferences,
  EmailFrequency,
} from '@/types/notifications';

interface NotificationSettingsProps {
  className?: string;
}

export function NotificationSettings({ className }: NotificationSettingsProps) {
  const { getAccessToken, user } = useMicrosoftAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isEmailConfigured, setIsEmailConfigured] = useState(false);

  const [preferences, setPreferences] = useState<Partial<NotificationPreferences>>({
    email_enabled: false,
    email_frequency: 'daily',
    email_address: null,
    notify_critical_only: false,
  });

  // Fetch current preferences
  useEffect(() => {
    async function fetchPreferences() {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const response = await fetch('/api/notifications/preferences', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setPreferences(data.preferences);
          setIsEmailConfigured(data.isEmailConfigured);
        }
      } catch (err) {
        console.error('Failed to fetch preferences:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchPreferences();
  }, [getAccessToken]);

  const handleSave = async (sendTest = false) => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      const response = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...preferences,
          sendTestEmail: sendTest,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save preferences');
      }

      const data = await response.json();
      setPreferences(data.preferences);

      if (sendTest) {
        if (data.testEmailSent) {
          setSuccess('Test email sent successfully');
        } else if (data.testEmailError) {
          setError(`Test email failed: ${data.testEmailError}`);
        }
      } else {
        setSuccess('Preferences saved');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    setIsSendingTest(true);
    setError(null);
    setSuccess(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setError('Authentication required');
        return;
      }

      // Save current preferences and send test
      await handleSave(true);
    } finally {
      setIsSendingTest(false);
    }
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
    <div className={cn('glass-light rounded-xl p-6 border border-black/5 hover:border-accent-cyan/20 transition-colors', className)}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-accent-cyan/10 flex items-center justify-center">
          <Bell className="w-5 h-5 text-accent-cyan" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Email Notifications</h2>
          <p className="text-sm text-text-secondary">Get notified when app updates are available</p>
        </div>
      </div>

      {!isEmailConfigured && (
        <div className="mb-6 p-3 bg-status-warning/10 border border-status-warning/20 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-status-warning flex-shrink-0 mt-0.5" />
          <p className="text-sm text-status-warning">
            Email notifications are not configured. Contact the administrator to enable this feature.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-primary font-medium">Enable Email Notifications</p>
            <p className="text-sm text-text-secondary">Receive email alerts for app updates</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.email_enabled}
              onChange={(e) =>
                setPreferences({ ...preferences, email_enabled: e.target.checked })
              }
              disabled={!isEmailConfigured}
              className="sr-only peer"
            />
            <div className={cn(
              "w-11 h-6 rounded-full transition-colors",
              "bg-black/10 peer-checked:bg-accent-cyan",
              "peer-focus:ring-2 peer-focus:ring-accent-cyan/20",
              "peer-disabled:opacity-50 peer-disabled:cursor-not-allowed",
              "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
              "after:bg-white after:rounded-full after:h-5 after:w-5",
              "after:transition-transform peer-checked:after:translate-x-5",
              "after:shadow-sm"
            )} />
          </label>
        </div>

        {/* Frequency */}
        <div className={cn(!preferences.email_enabled && 'opacity-50 pointer-events-none')}>
          <p className="text-text-primary font-medium mb-2">Notification Frequency</p>
          <div className="flex gap-2">
            {(['immediate', 'daily', 'weekly'] as EmailFrequency[]).map((freq) => (
              <button
                key={freq}
                onClick={() => setPreferences({ ...preferences, email_frequency: freq })}
                className={cn(
                  'px-4 py-2 rounded-lg border text-sm transition-all',
                  preferences.email_frequency === freq
                    ? 'bg-accent-cyan/10 border-accent-cyan/50 text-accent-cyan font-medium'
                    : 'bg-bg-elevated border-black/10 text-text-secondary hover:border-black/20'
                )}
              >
                {freq.charAt(0).toUpperCase() + freq.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted mt-2">
            {preferences.email_frequency === 'immediate' && 'Get notified as soon as updates are detected'}
            {preferences.email_frequency === 'daily' && 'Receive a daily digest of available updates'}
            {preferences.email_frequency === 'weekly' && 'Receive a weekly summary of available updates'}
          </p>
        </div>

        {/* Override email */}
        <div className={cn(!preferences.email_enabled && 'opacity-50 pointer-events-none')}>
          <p className="text-text-primary font-medium mb-2">Email Address</p>
          <Input
            type="email"
            placeholder={user?.email || 'your@email.com'}
            value={preferences.email_address || ''}
            onChange={(e) =>
              setPreferences({
                ...preferences,
                email_address: e.target.value || null,
              })
            }
            className="bg-bg-elevated border-black/10 text-text-primary placeholder:text-text-muted"
          />
          <p className="text-xs text-text-muted mt-1">
            Leave blank to use your account email
          </p>
        </div>

        {/* Critical only */}
        <div className={cn(
          'flex items-center justify-between',
          !preferences.email_enabled && 'opacity-50 pointer-events-none'
        )}>
          <div>
            <p className="text-text-primary font-medium">Critical Updates Only</p>
            <p className="text-sm text-text-secondary">Only notify for major version updates</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={preferences.notify_critical_only}
              onChange={(e) =>
                setPreferences({ ...preferences, notify_critical_only: e.target.checked })
              }
              className="sr-only peer"
            />
            <div className={cn(
              "w-11 h-6 rounded-full transition-colors",
              "bg-black/10 peer-checked:bg-accent-cyan",
              "peer-focus:ring-2 peer-focus:ring-accent-cyan/20",
              "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
              "after:bg-white after:rounded-full after:h-5 after:w-5",
              "after:transition-transform peer-checked:after:translate-x-5",
              "after:shadow-sm"
            )} />
          </label>
        </div>

        {/* Status messages */}
        {error && (
          <div className="p-3 bg-status-error/10 border border-status-error/20 rounded-lg">
            <p className="text-sm text-status-error">{error}</p>
          </div>
        )}

        {success && (
          <div className="p-3 bg-status-success/10 border border-status-success/20 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-status-success" />
            <p className="text-sm text-status-success">{success}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={() => handleSave(false)}
            disabled={isSaving}
            className="bg-accent-cyan hover:bg-accent-cyan-bright text-white"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Preferences'
            )}
          </Button>

          {preferences.email_enabled && isEmailConfigured && (
            <Button
              onClick={handleSendTestEmail}
              disabled={isSendingTest || isSaving}
              variant="outline"
              className="border-black/10 hover:border-accent-cyan/50"
            >
              {isSendingTest ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send Test Email
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotificationSettings;
