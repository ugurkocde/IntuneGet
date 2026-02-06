/**
 * Notification Service
 * Utility for creating and managing in-app notifications
 */

import { createServerClient } from '@/lib/supabase';

// ============================================
// Types
// ============================================

export type NotificationType =
  | 'deployment_complete'
  | 'deployment_failed'
  | 'consent_expired'
  | 'consent_revoked'
  | 'suggestion_approved'
  | 'suggestion_implemented'
  | 'member_joined'
  | 'member_removed'
  | 'feedback_received'
  | 'update_available';

export interface NotificationInput {
  user_id: string;
  user_email: string;
  type: NotificationType;
  title: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  user_id: string;
  user_email: string;
  type: NotificationType;
  title: string;
  message: string | null;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

// ============================================
// Notification Creation
// ============================================

/**
 * Create a notification for a user
 */
export async function createNotification(input: NotificationInput): Promise<void> {
  try {
    const supabase = createServerClient();

    const { error } = await supabase
      .from('user_notifications')
      .insert({
        user_id: input.user_id,
        user_email: input.user_email,
        type: input.type,
        title: input.title.substring(0, 200),
        message: input.message?.substring(0, 1000) || null,
        data: input.data || null,
      });

    if (error) {
      console.error('Failed to create notification:', error);
    }
  } catch (error) {
    console.error('Notification creation error:', error);
  }
}

/**
 * Create notifications for multiple users
 */
export async function createBulkNotifications(
  notifications: NotificationInput[]
): Promise<void> {
  try {
    const supabase = createServerClient();

    const rows = notifications.map((n) => ({
      user_id: n.user_id,
      user_email: n.user_email,
      type: n.type,
      title: n.title.substring(0, 200),
      message: n.message?.substring(0, 1000) || null,
      data: n.data || null,
    }));

    const { error } = await supabase
      .from('user_notifications')
      .insert(rows);

    if (error) {
      console.error('Failed to create bulk notifications:', error);
    }
  } catch (error) {
    console.error('Bulk notification creation error:', error);
  }
}

// ============================================
// Notification Helpers
// ============================================

/**
 * Notify user of deployment completion
 */
export async function notifyDeploymentComplete(
  userId: string,
  userEmail: string,
  appName: string,
  intuneAppId: string
): Promise<void> {
  await createNotification({
    user_id: userId,
    user_email: userEmail,
    type: 'deployment_complete',
    title: `${appName} deployed successfully`,
    message: 'Your app has been deployed to Intune.',
    data: { intune_app_id: intuneAppId, app_name: appName },
  });
}

/**
 * Notify user of deployment failure
 */
export async function notifyDeploymentFailed(
  userId: string,
  userEmail: string,
  appName: string,
  errorMessage: string
): Promise<void> {
  await createNotification({
    user_id: userId,
    user_email: userEmail,
    type: 'deployment_failed',
    title: `${appName} deployment failed`,
    message: errorMessage,
    data: { app_name: appName, error: errorMessage },
  });
}

/**
 * Notify user that their suggestion was approved
 */
export async function notifySuggestionApproved(
  userId: string,
  userEmail: string,
  wingetId: string
): Promise<void> {
  await createNotification({
    user_id: userId,
    user_email: userEmail,
    type: 'suggestion_approved',
    title: `Your suggestion was approved!`,
    message: `${wingetId} has been approved and will be added soon.`,
    data: { winget_id: wingetId },
  });
}

/**
 * Notify user that their suggestion was implemented
 */
export async function notifySuggestionImplemented(
  userId: string,
  userEmail: string,
  wingetId: string
): Promise<void> {
  await createNotification({
    user_id: userId,
    user_email: userEmail,
    type: 'suggestion_implemented',
    title: `Your suggestion is now available!`,
    message: `${wingetId} has been added to IntuneGet. Thank you for your contribution!`,
    data: { winget_id: wingetId },
  });
}

/**
 * Notify organization members of a new member
 */
export async function notifyMemberJoined(
  members: Array<{ user_id: string; user_email: string }>,
  newMemberEmail: string,
  orgName: string
): Promise<void> {
  const notifications = members.map((m) => ({
    user_id: m.user_id,
    user_email: m.user_email,
    type: 'member_joined' as NotificationType,
    title: `New team member joined`,
    message: `${newMemberEmail} has joined ${orgName}.`,
    data: { member_email: newMemberEmail, organization_name: orgName },
  }));

  await createBulkNotifications(notifications);
}

/**
 * Notify a user that they were removed from an organization
 */
export async function notifyMemberRemoved(
  userId: string,
  userEmail: string,
  orgName: string,
  removedByEmail: string
): Promise<void> {
  await createNotification({
    user_id: userId,
    user_email: userEmail,
    type: 'member_removed',
    title: `You were removed from ${orgName}`,
    message: `${removedByEmail} removed you from the organization.`,
    data: { organization_name: orgName, removed_by: removedByEmail },
  });
}

/**
 * Notify user of available update
 */
export async function notifyUpdateAvailable(
  userId: string,
  userEmail: string,
  appName: string,
  currentVersion: string,
  latestVersion: string
): Promise<void> {
  await createNotification({
    user_id: userId,
    user_email: userEmail,
    type: 'update_available',
    title: `Update available: ${appName}`,
    message: `Version ${latestVersion} is available (current: ${currentVersion})`,
    data: {
      app_name: appName,
      current_version: currentVersion,
      latest_version: latestVersion,
    },
  });
}

// ============================================
// Query Functions
// ============================================

export interface NotificationQueryResult {
  notifications: Notification[];
  unread_count: number;
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userId: string,
  limit: number = 20,
  unreadOnly: boolean = false
): Promise<NotificationQueryResult> {
  const supabase = createServerClient();

  let query = supabase
    .from('user_notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.is('read_at', null);
  }

  const { data: notifications, error } = await query;

  if (error) {
    console.error('Error fetching notifications:', error);
    return { notifications: [], unread_count: 0 };
  }

  // Get unread count
  const { count: unreadCount } = await supabase
    .from('user_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  return {
    notifications: (notifications || []) as Notification[],
    unread_count: unreadCount || 0,
  };
}

/**
 * Mark notifications as read
 */
export async function markNotificationsAsRead(
  notificationIds: string[]
): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', notificationIds);

  if (error) {
    console.error('Error marking notifications as read:', error);
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  const supabase = createServerClient();

  const { error } = await supabase
    .from('user_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) {
    console.error('Error marking all notifications as read:', error);
  }
}
