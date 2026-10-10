// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const auth = vi.hoisted(() => ({
  user: { id: 'test-user', email: 'admin@example.test' },
  getAccessToken: vi.fn().mockResolvedValue('test-token'),
}));
vi.mock('@/hooks/useMicrosoftAuth', () => ({ useMicrosoftAuth: () => auth }));
import { NotificationSettings } from './NotificationSettings';
import { WebhookManager } from './WebhookManager';
import { NOTIFICATION_SETUP_GUIDE_URL, WEBHOOK_STORAGE_UNAVAILABLE_MESSAGE } from '@/types/notifications';

let root: Root | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function render(component: () => unknown, response: Response) {
  const fetchMock = vi.fn(async () => response.clone());
  vi.stubGlobal('fetch', fetchMock);
  const node = document.createElement('div'); document.body.append(node); root = createRoot(node);
  await act(async () => root!.render(createElement(component as never)));
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  return fetchMock;
}
const guideLink = () => document.querySelector<HTMLAnchorElement>(`a[href="${NOTIFICATION_SETUP_GUIDE_URL}"]`);
const preferences = { user_id: 'test-user', email_enabled: false, email_frequency: 'daily', email_address: null, notify_critical_only: false };

describe('email notification setup guidance', () => {
  it('explains that SQLite only deployments need Supabase and links the setup guide', async () => {
    await render(NotificationSettings, Response.json({ preferences, isEmailConfigured: false, emailSetupRequirement: 'supabase' }));
    expect(document.body.textContent).toContain('Email notifications need Supabase on this server.');
    expect(document.body.textContent).not.toContain('Contact the administrator');
    expect(guideLink()?.textContent).toBe('See the notification setup guide');
  });
  it('names the email delivery settings when only Resend is missing', async () => {
    await render(NotificationSettings, Response.json({ preferences, isEmailConfigured: false, emailSetupRequirement: 'resend' }));
    expect(document.body.textContent).toContain('RESEND_API_KEY and RESEND_FROM_EMAIL');
    expect(guideLink()).not.toBeNull();
  });
  it('shows no setup notice when email is configured', async () => {
    await render(NotificationSettings, Response.json({ preferences, isEmailConfigured: true, emailSetupRequirement: null }));
    expect(guideLink()).toBeNull();
  });
});

describe('webhook notification setup guidance', () => {
  it('shows the server requirement and disables adding webhooks when storage is unavailable', async () => {
    await render(WebhookManager, Response.json({ error: WEBHOOK_STORAGE_UNAVAILABLE_MESSAGE }, { status: 503 }));
    expect(document.body.textContent).toContain(WEBHOOK_STORAGE_UNAVAILABLE_MESSAGE);
    expect(document.body.textContent).not.toContain('No webhooks configured');
    expect(guideLink()).not.toBeNull();
    const add = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Add Webhook'));
    expect(add?.disabled).toBe(true);
  });
  it('keeps adding webhooks available when storage is configured', async () => {
    await render(WebhookManager, Response.json({ webhooks: [] }));
    expect(document.body.textContent).toContain('No webhooks configured');
    expect(guideLink()).toBeNull();
    const add = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Add Webhook'));
    expect(add?.disabled).toBe(false);
  });
});
