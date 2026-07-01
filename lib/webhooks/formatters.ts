/**
 * Webhook Formatters
 * Format notification payloads for different webhook platforms
 */

import type {
  NotificationPayload,
  WebhookTestPayload,
  AppUpdate,
} from '@/types/notifications';

// Machine-readable data included alongside the presentation payload
export interface WebhookDataUpdate {
  displayName: string;
  wingetId: string;
  intuneAppId: string;
  fromVersion: string;
  toVersion: string;
  isCritical: boolean;
}

export interface WebhookData {
  event: NotificationPayload['event'];
  timestamp: string;
  tenant_id: string;
  tenant_name?: string;
  summary: {
    total: number;
    critical: number;
  };
  updates: WebhookDataUpdate[];
}

type WebhookPayloadData = WebhookData | WebhookTestPayload;

// Use flexible types for external webhook payloads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlackPayload = { blocks: any[]; data: WebhookPayloadData };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TeamsPayload = { type: string; attachments: any[]; data: WebhookPayloadData };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordPayload = { embeds: any[]; data: WebhookPayloadData };

/**
 * Build the machine-readable data object attached to every webhook payload
 */
export function buildWebhookData(payload: NotificationPayload): WebhookData {
  return {
    event: payload.event,
    timestamp: payload.timestamp,
    tenant_id: payload.tenant_id,
    tenant_name: payload.tenant_name,
    summary: {
      total: payload.summary.total,
      critical: payload.summary.critical,
    },
    updates: payload.updates.map((app) => ({
      displayName: app.app_name,
      wingetId: app.winget_id,
      intuneAppId: app.intune_app_id,
      fromVersion: app.current_version,
      toVersion: app.latest_version,
      isCritical: app.is_critical,
    })),
  };
}

// Discord color values (must be integer)
const DISCORD_BRAND_COLOR = 0x8b5cf6;
const DISCORD_CRITICAL_COLOR = 0xdc2626;
const DISCORD_SUCCESS_COLOR = 0x22c55e;

/**
 * Format notification payload for Slack Block Kit
 */
export function formatSlackMessage(payload: NotificationPayload): SlackPayload {
  const { updates, summary, tenant_name } = payload;
  const criticalUpdates = updates.filter((u) => u.is_critical);
  const regularUpdates = updates.filter((u) => !u.is_critical);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    // Header
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: summary.critical > 0
          ? `${summary.critical} Critical App Update${summary.critical > 1 ? 's' : ''} Available`
          : `${summary.total} App Update${summary.total > 1 ? 's' : ''} Available`,
        emoji: true,
      },
    },
    // Context
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*IntuneGet* | ${new Date(payload.timestamp).toLocaleString()}${tenant_name ? ` | Tenant: ${tenant_name}` : ''}`,
        },
      ],
    },
    // Summary
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Total Updates*\n${summary.total}`,
        },
        {
          type: 'mrkdwn',
          text: `*Critical Updates*\n${summary.critical}`,
        },
      ],
    },
    {
      type: 'divider',
    },
  ];

  // Critical updates section
  if (criticalUpdates.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:warning: Critical Updates (Major Version)*',
      },
    });

    criticalUpdates.forEach((app) => {
      blocks.push(formatSlackAppBlock(app));
    });
  }

  // Regular updates section
  if (regularUpdates.length > 0) {
    if (criticalUpdates.length > 0) {
      blocks.push({ type: 'divider' });
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Available Updates*',
      },
    });

    // Limit to first 5 regular updates to avoid message length limits
    const displayUpdates = regularUpdates.slice(0, 5);
    displayUpdates.forEach((app) => {
      blocks.push(formatSlackAppBlock(app));
    });

    if (regularUpdates.length > 5) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_...and ${regularUpdates.length - 5} more updates_`,
          },
        ],
      });
    }
  }

  // Action button
  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View in Dashboard',
            emoji: true,
          },
          url: process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
            : 'https://intuneget.com/dashboard',
          style: 'primary',
        },
      ],
    }
  );

  return { blocks, data: buildWebhookData(payload) };
}

/**
 * Format a single app update for Slack
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSlackAppBlock(app: AppUpdate): any {
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${app.app_name}*\n\`${app.winget_id}\`\n${app.current_version} :arrow_right: ${app.latest_version}`,
    },
  };
}

/**
 * Format notification payload for Microsoft Teams Adaptive Card
 */
export function formatTeamsMessage(payload: NotificationPayload): TeamsPayload {
  const { updates, summary, tenant_name } = payload;
  const criticalUpdates = updates.filter((u) => u.is_critical);
  const regularUpdates = updates.filter((u) => !u.is_critical);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = [
    // Header
    {
      type: 'TextBlock',
      text: summary.critical > 0
        ? `${summary.critical} Critical App Update${summary.critical > 1 ? 's' : ''} Available`
        : `${summary.total} App Update${summary.total > 1 ? 's' : ''} Available`,
      size: 'Large',
      weight: 'Bolder',
      wrap: true,
    },
    // Context
    {
      type: 'TextBlock',
      text: `IntuneGet | ${new Date(payload.timestamp).toLocaleString()}${tenant_name ? ` | Tenant: ${tenant_name}` : ''}`,
      size: 'Small',
      isSubtle: true,
      wrap: true,
    },
    // Summary facts
    {
      type: 'FactSet',
      facts: [
        { title: 'Total Updates', value: summary.total.toString() },
        { title: 'Critical Updates', value: summary.critical.toString() },
      ],
    },
  ];

  // Critical updates section
  if (criticalUpdates.length > 0) {
    body.push({
      type: 'TextBlock',
      text: 'Critical Updates (Major Version)',
      weight: 'Bolder',
      spacing: 'Medium',
      wrap: true,
    });

    criticalUpdates.forEach((app) => {
      body.push(formatTeamsAppCard(app));
    });
  }

  // Regular updates section
  if (regularUpdates.length > 0) {
    body.push({
      type: 'TextBlock',
      text: 'Available Updates',
      weight: 'Bolder',
      spacing: 'Medium',
      wrap: true,
    });

    // Limit to first 5
    const displayUpdates = regularUpdates.slice(0, 5);
    displayUpdates.forEach((app) => {
      body.push(formatTeamsAppCard(app));
    });

    if (regularUpdates.length > 5) {
      body.push({
        type: 'TextBlock',
        text: `...and ${regularUpdates.length - 5} more updates`,
        isSubtle: true,
        wrap: true,
      });
    }
  }

  return {
    type: 'message',
    data: buildWebhookData(payload),
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          actions: [
            {
              type: 'Action.OpenUrl',
              title: 'View in Dashboard',
              url: process.env.NEXT_PUBLIC_APP_URL
                ? `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`
                : 'https://intuneget.com/dashboard',
            },
          ],
        },
      },
    ],
  };
}

/**
 * Format a single app update for Teams
 */
function formatTeamsAppCard(app: AppUpdate) {
  return {
    type: 'Container',
    items: [
      {
        type: 'TextBlock',
        text: app.app_name,
        weight: 'Bolder',
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: app.winget_id,
        size: 'Small',
        isSubtle: true,
        wrap: true,
      },
      {
        type: 'TextBlock',
        text: `${app.current_version} -> ${app.latest_version}`,
        wrap: true,
      },
    ],
    spacing: 'Small',
    separator: true,
  };
}

/**
 * Format notification payload for Discord embed
 */
export function formatDiscordMessage(payload: NotificationPayload): DiscordPayload {
  const { updates, summary, tenant_name } = payload;
  const criticalUpdates = updates.filter((u) => u.is_critical);
  const regularUpdates = updates.filter((u) => !u.is_critical);

  const embeds = [];

  // Main embed
  const mainEmbed = {
    title: summary.critical > 0
      ? `${summary.critical} Critical App Update${summary.critical > 1 ? 's' : ''} Available`
      : `${summary.total} App Update${summary.total > 1 ? 's' : ''} Available`,
    description: tenant_name ? `Tenant: ${tenant_name}` : undefined,
    color: summary.critical > 0 ? DISCORD_CRITICAL_COLOR : DISCORD_BRAND_COLOR,
    fields: [
      {
        name: 'Total Updates',
        value: summary.total.toString(),
        inline: true,
      },
      {
        name: 'Critical Updates',
        value: summary.critical.toString(),
        inline: true,
      },
    ],
    footer: {
      text: 'IntuneGet',
    },
    timestamp: payload.timestamp,
  };

  embeds.push(mainEmbed);

  // Critical updates embed
  if (criticalUpdates.length > 0) {
    const criticalFields = criticalUpdates.slice(0, 5).map((app) => ({
      name: app.app_name,
      value: `\`${app.winget_id}\`\n${app.current_version} -> ${app.latest_version}`,
      inline: false,
    }));

    if (criticalUpdates.length > 5) {
      criticalFields.push({
        name: 'More...',
        value: `...and ${criticalUpdates.length - 5} more critical updates`,
        inline: false,
      });
    }

    embeds.push({
      title: 'Critical Updates (Major Version)',
      color: DISCORD_CRITICAL_COLOR,
      fields: criticalFields,
    });
  }

  // Regular updates embed
  if (regularUpdates.length > 0) {
    const regularFields = regularUpdates.slice(0, 5).map((app) => ({
      name: app.app_name,
      value: `\`${app.winget_id}\`\n${app.current_version} -> ${app.latest_version}`,
      inline: false,
    }));

    if (regularUpdates.length > 5) {
      regularFields.push({
        name: 'More...',
        value: `...and ${regularUpdates.length - 5} more updates`,
        inline: false,
      });
    }

    embeds.push({
      title: 'Available Updates',
      color: DISCORD_BRAND_COLOR,
      fields: regularFields,
    });
  }

  return { embeds, data: buildWebhookData(payload) };
}

/**
 * Format notification payload for custom webhooks (raw JSON)
 * Keeps the original NotificationPayload fields for backward compatibility
 * and adds the machine-readable data object
 */
export function formatCustomPayload(
  payload: NotificationPayload
): NotificationPayload & { data: WebhookData } {
  return { ...payload, data: buildWebhookData(payload) };
}

/**
 * Format test message for Slack
 */
export function formatSlackTestMessage(payload: WebhookTestPayload): SlackPayload {
  return {
    data: payload,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'IntuneGet Webhook Test',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: payload.message,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Webhook: *${payload.webhook_name}* | ${new Date(payload.timestamp).toLocaleString()}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':white_check_mark: *Configuration successful!*',
        },
      },
    ],
  };
}

/**
 * Format test message for Teams
 */
export function formatTeamsTestMessage(payload: WebhookTestPayload): TeamsPayload {
  return {
    type: 'message',
    data: payload,
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: 'IntuneGet Webhook Test',
              size: 'Large',
              weight: 'Bolder',
              wrap: true,
            },
            {
              type: 'TextBlock',
              text: payload.message,
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Webhook', value: payload.webhook_name },
                { title: 'Time', value: new Date(payload.timestamp).toLocaleString() },
              ],
            },
            {
              type: 'TextBlock',
              text: 'Configuration successful!',
              weight: 'Bolder',
              wrap: true,
            },
          ],
        },
      },
    ],
  };
}

/**
 * Format test message for Discord
 */
export function formatDiscordTestMessage(payload: WebhookTestPayload): DiscordPayload {
  return {
    data: payload,
    embeds: [
      {
        title: 'IntuneGet Webhook Test',
        description: payload.message,
        color: DISCORD_SUCCESS_COLOR,
        fields: [
          {
            name: 'Webhook',
            value: payload.webhook_name,
            inline: true,
          },
          {
            name: 'Status',
            value: 'Configuration successful!',
            inline: true,
          },
        ],
        footer: {
          text: 'IntuneGet',
        },
        timestamp: payload.timestamp,
      },
    ],
  };
}
