'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import type { Notification } from '@/lib/notification-service';

interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

interface UnreadCountResponse {
  unread_count: number;
}

interface MarkReadResponse {
  success: boolean;
  marked_count: number;
}

interface MarkAllReadResponse {
  success: boolean;
}

/**
 * Hook to fetch user notifications
 */
export function useNotifications(limit: number = 20, unreadOnly: boolean = false) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery<NotificationsResponse>({
    queryKey: ['notifications', limit, unreadOnly],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const params = new URLSearchParams({
        limit: limit.toString(),
      });
      if (unreadOnly) {
        params.set('unread_only', 'true');
      }

      const response = await fetch(`/api/notifications?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Poll every minute
  });
}

/**
 * Hook to fetch unread notification count for badge display
 */
export function useUnreadCount() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery<UnreadCountResponse>({
    queryKey: ['notifications', 'unreadCount'],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/notifications/unread-count', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch unread count');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Poll every minute
  });
}

/**
 * Hook to mark specific notifications as read
 */
export function useMarkAsRead() {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();

  return useMutation<MarkReadResponse, Error, string[]>({
    mutationFn: async (notificationIds: string[]) => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notification_ids: notificationIds }),
      });

      if (!response.ok) {
        throw new Error('Failed to mark notifications as read');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate both notifications and unread count queries
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * Hook to mark all notifications as read
 */
export function useMarkAllAsRead() {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();

  return useMutation<MarkAllReadResponse, Error, void>({
    mutationFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate both notifications and unread count queries
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
