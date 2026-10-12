/**
 * Notification System Types
 * Types for email and webhook notifications
 */

// Email frequency options
export type EmailFrequency = 'immediate' | 'daily' | 'weekly';

// Webhook types
export type WebhookType = 'slack' | 'teams' | 'discord' | 'custom';

// Notification channels
export type NotificationChannel = 'email' | 'webhook';

// Notification status
export type NotificationStatus = 'pending' | 'sent' | 'failed';

// Server setup still needed before email notifications can be used
export type EmailSetupRequirement = 'supabase' | 'resend';

// Shown when a deployment has no Supabase storage for webhook settings
export const WEBHOOK_STORAGE_UNAVAILABLE_MESSAGE =
  'Webhook notifications require Supabase to be configured for this deployment.';

// Self hosting guide section that explains notification setup
export const NOTIFICATION_SETUP_GUIDE_URL =
  'https://github.com/ugurkocde/IntuneGet/blob/main/docs/SELF_HOSTING.md#notification-configuration';

/**
 * Notification Preferences
 */
export interface NotificationPreferences {
  id: string;
  user_id: string;
  email_enabled: boolean;
  email_frequency: EmailFrequency;
  email_address: string | null;
  notify_critical_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferencesInput {
  email_enabled?: boolean;
  email_frequency?: EmailFrequency;
  email_address?: string | null;
  notify_critical_only?: boolean;
}

/**
 * Webhook Configuration
 */
export interface WebhookConfiguration {
  id: string;
  user_id: string;
  name: string;
  url: string;
  webhook_type: WebhookType;
  secret: string | null;
  headers: Record<string, string>;
  is_enabled: boolean;
  failure_count: number;
  last_failure_at: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookConfigurationInput {
  name: string;
  url: string;
  webhook_type: WebhookType;
  secret?: string | null;
  headers?: Record<string, string>;
  is_enabled?: boolean;
}

export interface WebhookConfigurationUpdate {
  name?: string;
  url?: string;
  webhook_type?: WebhookType;
  secret?: string | null;
  headers?: Record<string, string>;
  is_enabled?: boolean;
}

/**
 * Notification History
 */
export interface NotificationHistory {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  webhook_id: string | null;
  payload: NotificationPayload;
  status: NotificationStatus;
  error_message: string | null;
  apps_notified: number;
  created_at: string;
  sent_at: string | null;
  updated_at: string;
}

/**
 * Update Check Result
 */
export interface UpdateCheckResult {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
  notified_at: string | null;
  dismissed_at: string | null;
  detected_at: string;
  updated_at: string;
}

/**
 * Notification Payload
 */
export interface AppUpdate {
  app_name: string;
  winget_id: string;
  intune_app_id: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
}

export interface NotificationPayload {
  event: 'app_updates_available';
  timestamp: string;
  tenant_id: string;
  tenant_name?: string;
  updates: AppUpdate[];
  summary: {
    total: number;
    critical: number;
  };
}

/**
 * Notification Stats (from view)
 */
export interface NotificationStats {
  user_id: string;
  email_enabled: boolean;
  email_frequency: EmailFrequency;
  notify_critical_only: boolean;
  active_webhooks: number;
  pending_updates: number;
  pending_critical_updates: number;
  notifications_sent_30d: number;
  created_at: string;
  updated_at: string;
}

/**
 * Webhook Test Payload
 */
export interface WebhookTestPayload {
  event: 'test';
  timestamp: string;
  message: string;
  webhook_name: string;
}

/**
 * Slack Block Kit Message
 */
export interface SlackMessage {
  blocks: SlackBlock[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    value?: string;
    style?: string;
    url?: string;
    action_id?: string;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
  accessory?: {
    type: string;
    text?: {
      type: string;
      text: string;
      emoji?: boolean;
    };
    value?: string;
    url?: string;
    action_id?: string;
  };
}

/**
 * Microsoft Teams Adaptive Card
 */
export interface TeamsMessage {
  type: string;
  attachments: TeamsAttachment[];
}

export interface TeamsAttachment {
  contentType: string;
  content: TeamsAdaptiveCard;
}

export interface TeamsAdaptiveCard {
  $schema: string;
  type: string;
  version: string;
  body: TeamsCardElement[];
  actions?: TeamsCardAction[];
}

export interface TeamsCardElement {
  type: string;
  text?: string;
  size?: string;
  weight?: string;
  wrap?: boolean;
  items?: TeamsCardElement[];
  columns?: TeamsCardColumn[];
  spacing?: string;
  separator?: boolean;
  facts?: Array<{ title: string; value: string }>;
  isSubtle?: boolean;
}

export interface TeamsCardColumn {
  type: string;
  width: string;
  items: TeamsCardElement[];
}

export interface TeamsCardAction {
  type: string;
  title: string;
  url?: string;
}

/**
 * Discord Embed Message
 */
export interface DiscordMessage {
  embeds: DiscordEmbed[];
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields: DiscordField[];
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string;
}

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * Email Template Data
 */
export interface EmailTemplateData {
  user_name?: string;
  updates: AppUpdate[];
  summary: {
    total: number;
    critical: number;
  };
  tenant_name?: string;
  dashboard_url: string;
  unsubscribe_url?: string;
}
