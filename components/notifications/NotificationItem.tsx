'use client';

import { cn, formatRelativeTime } from '@/lib/utils';
import type { Notification, NotificationType } from '@/lib/notification-service';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  UserPlus,
  UserMinus,
  ThumbsUp,
  Sparkles,
  Bell,
  ArrowUpCircle,
} from 'lucide-react';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead?: (id: string) => void;
  onClick?: (notification: Notification) => void;
}

const notificationIcons: Record<NotificationType, React.ComponentType<{ className?: string }>> = {
  deployment_complete: CheckCircle2,
  deployment_failed: XCircle,
  consent_expired: AlertTriangle,
  consent_revoked: AlertTriangle,
  suggestion_approved: ThumbsUp,
  suggestion_implemented: Sparkles,
  member_joined: UserPlus,
  member_removed: UserMinus,
  feedback_received: Bell,
  update_available: ArrowUpCircle,
};

const notificationColors: Record<NotificationType, string> = {
  deployment_complete: 'text-emerald-400',
  deployment_failed: 'text-red-400',
  consent_expired: 'text-amber-400',
  consent_revoked: 'text-amber-400',
  suggestion_approved: 'text-accent-cyan',
  suggestion_implemented: 'text-accent-violet',
  member_joined: 'text-accent-cyan',
  member_removed: 'text-amber-400',
  feedback_received: 'text-accent-cyan',
  update_available: 'text-blue-400',
};

export function NotificationItem({
  notification,
  onMarkAsRead,
  onClick,
}: NotificationItemProps) {
  const Icon = notificationIcons[notification.type] || Bell;
  const iconColor = notificationColors[notification.type] || 'text-text-secondary';
  const isUnread = !notification.read_at;

  const handleClick = () => {
    if (isUnread && onMarkAsRead) {
      onMarkAsRead(notification.id);
    }
    if (onClick) {
      onClick(notification);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        'w-full flex items-start gap-3 p-3 text-left rounded-lg transition-all duration-200',
        'hover:bg-bg-elevated/50',
        isUnread && 'bg-accent-cyan/5'
      )}
    >
      {/* Icon */}
      <div className={cn('flex-shrink-0 mt-0.5', iconColor)}>
        <Icon className="w-5 h-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              'text-sm font-medium truncate',
              isUnread ? 'text-text-primary' : 'text-text-secondary'
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-accent-cyan" />
          )}
        </div>
        {notification.message && (
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
            {notification.message}
          </p>
        )}
        <p className="text-xs text-text-muted mt-1">
          {formatRelativeTime(notification.created_at)}
        </p>
      </div>
    </button>
  );
}
