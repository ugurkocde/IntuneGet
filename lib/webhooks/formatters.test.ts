import { describe, it, expect } from 'vitest';

import {
  buildWebhookData,
  formatSlackMessage,
  formatTeamsMessage,
  formatDiscordMessage,
  formatCustomPayload,
  formatSlackTestMessage,
  formatTeamsTestMessage,
  formatDiscordTestMessage,
} from './formatters';
import type { NotificationPayload, WebhookTestPayload } from '@/types/notifications';

const payload: NotificationPayload = {
  event: 'app_updates_available',
  timestamp: '2026-06-25T12:40:07Z',
  tenant_id: 't1',
  tenant_name: 'Tenant',
  updates: [
    {
      app_name: 'Notepad++',
      winget_id: 'Notepad++.Notepad++',
      intune_app_id: 'a1',
      current_version: '8.9.4',
      latest_version: '8.9.6',
      is_critical: false,
    },
    {
      app_name: 'Chrome',
      winget_id: 'Google.Chrome',
      intune_app_id: 'a2',
      current_version: '1.0',
      latest_version: '2.0',
      is_critical: true,
    },
  ],
  summary: { total: 2, critical: 1 },
};

const expectedData = {
  event: 'app_updates_available',
  timestamp: '2026-06-25T12:40:07Z',
  tenant_id: 't1',
  tenant_name: 'Tenant',
  summary: { total: 2, critical: 1 },
  updates: [
    {
      displayName: 'Notepad++',
      wingetId: 'Notepad++.Notepad++',
      intuneAppId: 'a1',
      fromVersion: '8.9.4',
      toVersion: '8.9.6',
      isCritical: false,
    },
    {
      displayName: 'Chrome',
      wingetId: 'Google.Chrome',
      intuneAppId: 'a2',
      fromVersion: '1.0',
      toVersion: '2.0',
      isCritical: true,
    },
  ],
};

const testPayload: WebhookTestPayload = {
  event: 'test',
  timestamp: '2026-06-25T12:40:07Z',
  message: 'Test message',
  webhook_name: 'WH',
};

describe('buildWebhookData', () => {
  it('maps the notification payload to machine-readable data', () => {
    expect(buildWebhookData(payload)).toEqual(expectedData);
  });
});

describe('notification formatters', () => {
  it('includes structured data in the Slack payload alongside blocks', () => {
    const result = formatSlackMessage(payload);
    expect(result.data).toEqual(expectedData);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('includes structured data in the Teams payload alongside attachments', () => {
    const result = formatTeamsMessage(payload);
    expect(result.data).toEqual(expectedData);
    expect(result.type).toBe('message');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
  });

  it('includes structured data in the Discord payload alongside embeds', () => {
    const result = formatDiscordMessage(payload);
    expect(result.data).toEqual(expectedData);
    expect(result.embeds.length).toBeGreaterThan(0);
  });

  it('keeps original fields in the custom payload and adds structured data', () => {
    const result = formatCustomPayload(payload);
    expect(result).toEqual({ ...payload, data: expectedData });
  });
});

describe('test message formatters', () => {
  it('includes structured data in the Slack test payload', () => {
    const result = formatSlackTestMessage(testPayload);
    expect(result.data).toEqual(testPayload);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('includes structured data in the Teams test payload', () => {
    const result = formatTeamsTestMessage(testPayload);
    expect(result.data).toEqual(testPayload);
    expect(result.attachments).toHaveLength(1);
  });

  it('includes structured data in the Discord test payload', () => {
    const result = formatDiscordTestMessage(testPayload);
    expect(result.data).toEqual(testPayload);
    expect(result.embeds).toHaveLength(1);
  });
});
