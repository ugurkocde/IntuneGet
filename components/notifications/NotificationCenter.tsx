'use client';

import { useNotifications, useMarkAsRead, useMarkAllAsRead } from '@/hooks/useNotifications';
import { NotificationItem } from './NotificationItem';
import { Button } from '@/components/ui/button';
import { CheckCheck, Loader2, Inbox } from 'lucide-react';
import type { Notification } from '@/lib/notification-service';
import { useRouter } from 'next/navigation';

interface NotificationCenterProps {
  onClose?: () => void;
}

export function NotificationCenter({ onClose }: NotificationCenterProps) {
  const router = useRouter();
  const { data, isLoading } = useNotifications(20);
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = data?.notifications || [];
  const unreadCount = data?.unread_count || 0;

  const handleMarkAsRead = (id: string) => {
    markAsRead.mutate([id]);
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead.mutate();
  };

  const handleNotificationClick = (notification: Notification) => {
    // Navigate based on notification type and data
    const data = notification.data || {};

    switch (notification.type) {
      case 'deployment_complete':
      case 'deployment_failed':
        if (data.intune_app_id) {
          router.push('/dashboard/inventory');
        } else {
          router.push('/dashboard/uploads');
        }
        break;
      case 'suggestion_approved':
      case 'suggestion_implemented':
        if (data.winget_id) {
          router.push(`/dashboard/apps?q=${data.winget_id}`);
        }
        break;
      case 'member_joined':
      case 'member_removed':
        router.push('/dashboard/msp/team');
        break;
      case 'consent_expired':
      case 'consent_revoked':
        router.push('/dashboard/msp');
        break;
      case 'update_available':
        router.push('/dashboard/updates');
        break;
      default:
        // No specific navigation
        break;
    }

    onClose?.();
  };

  return (
    <div className="w-80 sm:w-96 bg-bg-surface border border-white/10 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllAsRead}
            disabled={markAllAsRead.isPending}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            {markAllAsRead.isPending ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <CheckCheck className="w-3 h-3 mr-1" />
            )}
            Mark all read
          </Button>
        )}
      </div>

      {/* Notification list */}
      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-text-muted animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Inbox className="w-10 h-10 text-text-muted mb-2" />
            <p className="text-sm text-text-muted">No notifications yet</p>
            <p className="text-xs text-text-muted mt-1">
              We&apos;ll notify you about important updates
            </p>
          </div>
        ) : (
          <div className="py-1">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={handleMarkAsRead}
                onClick={handleNotificationClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {notifications.length > 0 && (
        <div className="px-4 py-2 border-t border-white/10 bg-bg-elevated/30">
          <p className="text-xs text-text-muted text-center">
            Showing latest {notifications.length} notifications
          </p>
        </div>
      )}
    </div>
  );
}
