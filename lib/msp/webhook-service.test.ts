import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock, lookupMock, createServerClientMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  lookupMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));
vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));

import { queueWebhookDelivery, sendTestWebhook, processDueWebhookDeliveries } from './webhook-service';

type Reply = { statusCode: number; headers?: Record<string, string>; body?: string };
const sentBodies: string[] = [];

function respond(reply: Reply) {
  requestMock.mockImplementationOnce((_options, callback) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
    request.destroy = () => {};
    request.end = (body?: string) => { sentBodies.push(String(body)); queueMicrotask(() => {
      const response = Object.assign(new PassThrough(), { statusCode: reply.statusCode, headers: reply.headers ?? {} });
      callback(response);
      if (!response.destroyed) response.end(reply.body);
    }); };
    return request;
  });
}

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const NOT_PUBLIC = 'Webhook URL must point to a host on the public internet';
const BODY_MARKER = 'INTERNAL-RESPONSE-BODY';

const webhook = (url: string) => ({
  id: 'msp-webhook-1',
  organization_id: 'org-1',
  name: 'Fixture webhook',
  url,
  secret: 'shared-secret',
  event_types: ['deployment.completed'],
  headers: { 'X-Team': 'ops' },
  is_enabled: true,
  failure_count: 0,
});

/**
 * Minimal Supabase stand-in for queueWebhookDelivery: one enabled webhook,
 * one pending delivery, and a record of every update that is written.
 */
function supabaseWith(configuredWebhook: ReturnType<typeof webhook>) {
  const db = deliveryDb(configuredWebhook);
  return db.updates;
}

function deliveryDb(config = webhook('https://hooks.example.com/hook')) {
  const rows: Record<string, any[]> = { msp_webhook_configurations: [config], msp_webhook_deliveries: [] };
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  let insertError = false;
  const client = { from(table: string) {
    let action = 'select', values: any, single = false, cap = Infinity, sort: string | undefined;
    const filters: Array<(r: any) => boolean> = [];
    const q: any = {
      select: () => q,
      insert(v: any) { action = 'insert'; values = v; return q; },
      update(v: any) { action = 'update'; values = v; return q; },
      eq(k: string, v: any) { filters.push(r => r[k] === v); return q; },
      lte(k: string, v: any) { filters.push(r => r[k] != null && r[k] <= v); return q; },
      contains(k: string, v: any[]) { filters.push(r => v.every(x => r[k].includes(x))); return q; },
      order(k: string) { sort = k; return q; },
      limit(n: number) { cap = n; return q; },
      single() { single = true; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve: any, reject: any) {
        try {
          if (action === 'insert' && insertError) return Promise.resolve({ data: null, error: { message: 'fixture' } }).then(resolve, reject);
          let selected: any[];
          if (action === 'insert') {
            selected = values.map((v: any) => ({ id: `delivery-${rows[table].length + 1}-${v.payload.data.job}`, attempts: 0, max_attempts: 3, ...v }));
            rows[table].push(...selected);
          } else {
            selected = rows[table].filter(r => filters.every(f => f(r)));
            if (sort) selected.sort((a, b) => String(a[sort!]).localeCompare(String(b[sort!])));
            selected = selected.slice(0, cap);
            if (action === 'update') {
              selected.forEach(r => Object.assign(r, values));
              if (selected.length && (table === 'msp_webhook_configurations' || 'response_status' in values || 'error_message' in values)) updates.push({ table, values: { ...values, ...(table === 'msp_webhook_deliveries' ? { attempts: selected[0].attempts } : {}) } });
            }
          }
          const copied = selected.map(r => ({ ...r }));
          return Promise.resolve({ data: single ? copied[0] ?? null : copied, error: null }).then(resolve, reject);
        } catch (e) { return Promise.reject(e).then(resolve, reject); }
      },
    };
    return q;
  } };
  createServerClientMock.mockReturnValue(client);
  const add = (overrides: Record<string, unknown> = {}): any => {
    const row = { id: 'due', webhook_id: config.id, payload: { event_type: 'deployment.completed', organization_id: 'org-1', timestamp: '2026-01-01T00:00:00Z', data: { job: 'stored' } }, status: 'pending', attempts: 0, max_attempts: 3, next_retry_at: '2020-01-01T00:00:00Z', ...overrides };
    rows.msp_webhook_deliveries.push(row); return row;
  };
  return { rows, add, updates, failInsert: () => { insertError = true; } };
}

describe('MSP delivery identity and retry worker', () => {
  it('keeps concurrent new events bound to their own inserted rows', async () => {
    const db = deliveryDb(); const old = db.add({ id: 'old' });
    respond({ statusCode: 200 }); respond({ statusCode: 200 });
    await Promise.all(['one', 'two'].map(job => queueWebhookDelivery('org-1', 'deployment.completed', { job })));
    expect(old.status).toBe('pending');
    expect(db.rows.msp_webhook_deliveries.slice(1).map(r => [r.payload.data.job, r.status, r.attempts])).toEqual([['one', 'success', 1], ['two', 'success', 1]]);
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(sentBodies.map(body => JSON.parse(body).data.job).sort()).toEqual(['one', 'two']);
  });
  it('never sends when the insert failed', async () => {
    const db = deliveryDb(); db.add(); db.failInsert();
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'new' });
    expect(requestMock).not.toHaveBeenCalled();
  });
  it('claims a due delivery only once across overlapping workers', async () => {
    const db = deliveryDb(); const row = db.add(); respond({ statusCode: 200 });
    await Promise.all([processDueWebhookDeliveries(), processDueWebhookDeliveries()]);
    expect(requestMock).toHaveBeenCalledOnce(); expect(row).toMatchObject({ status: 'success', attempts: 1 });
  });
  it('retries only due records and preserves stored payload', async () => {
    const db = deliveryDb(); const due = db.add(); const future = db.add({ id: 'future', next_retry_at: '2099-01-01T00:00:00Z' });
    respond({ statusCode: 200 }); await processDueWebhookDeliveries();
    expect(due.status).toBe('success'); expect(future.attempts).toBe(0);
    expect(requestMock.mock.calls[0][0].headers['X-IntuneGet-Signature']).toBeTruthy();
    expect(sentBodies).toEqual([JSON.stringify(due.payload)]);
    expect(requestMock.mock.calls[0][0].headers['X-IntuneGet-Signature']).toBe(`sha256=${createHmac('sha256', 'shared-secret').update(sentBodies[0]).digest('hex')}`);
  });
  it('honors the final attempt and per-row retry limit', async () => {
    const db = deliveryDb(); const last = db.add({ attempts: 2 }); const more = db.add({ id: 'more', attempts: 3, max_attempts: 5 });
    respond({ statusCode: 500 }); respond({ statusCode: 500 }); const before = Date.now();
    await processDueWebhookDeliveries();
    expect(last).toMatchObject({ status: 'failed', attempts: 3 });
    expect(db.rows.msp_webhook_configurations[0].failure_count).toBe(1);
    expect(more).toMatchObject({ status: 'pending', attempts: 4 });
    expect(Date.parse(more.next_retry_at!)).toBeGreaterThanOrEqual(before + 16 * 60000);
  });
  it('does not resend an active lease and terminates exhausted interrupted claims', async () => {
    const db = deliveryDb(); db.add({ next_retry_at: '2099-01-01T00:00:00Z', attempts: 1 }); const exhausted = db.add({ id: 'exhausted', attempts: 3 });
    await processDueWebhookDeliveries(); expect(requestMock).not.toHaveBeenCalled(); expect(exhausted.status).toBe('failed');
  });
  it('recovers an interrupted claim after its lease expires', async () => {
    const db = deliveryDb(); const row = db.add({ attempts: 1, next_retry_at: '2099-01-01T00:00:00Z' });
    await processDueWebhookDeliveries(); expect(requestMock).not.toHaveBeenCalled();
    row.next_retry_at = '2020-01-01T00:00:00Z'; respond({ statusCode: 200 });
    await processDueWebhookDeliveries(); expect(row).toMatchObject({ status: 'success', attempts: 2 });
  });
  it('cannot finalize an expired claim after a newer worker has claimed it', async () => {
    const db = deliveryDb(); const row = db.add(); let reply: (() => void) | undefined;
    requestMock.mockImplementationOnce((_options, callback) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void };
      request.destroy = () => {};
      request.end = () => { reply = () => {
        const response = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
        callback(response); response.end('accepted');
      }; };
      return request;
    });
    const first = processDueWebhookDeliveries();
    await vi.waitFor(() => expect(reply).toBeDefined());
    row.attempts = 2; row.next_retry_at = '2099-01-01T00:00:00Z'; reply!(); await first;
    expect(row).toMatchObject({ status: 'pending', attempts: 2, next_retry_at: '2099-01-01T00:00:00Z' });
    expect(db.rows.msp_webhook_configurations[0].failure_count).toBe(0);
  });
  it.each(['disabled', 'organization mismatch'])('terminates %s without network traffic', async kind => {
    const config = webhook('https://hooks.example.com/hook'); if (kind === 'disabled') config.is_enabled = false;
    else config.organization_id = 'other';
    const db = deliveryDb(config); const row = db.add(); await processDueWebhookDeliveries();
    expect(requestMock).not.toHaveBeenCalled(); expect(row.status).toBe('failed');
    await processDueWebhookDeliveries(); expect(row.attempts).toBe(0);
  });
  it('revalidates the current destination on every retry', async () => {
    const db = deliveryDb(webhook('https://169.254.169.254/latest/meta-data/')); const row = db.add();
    await processDueWebhookDeliveries(); expect(requestMock).not.toHaveBeenCalled(); expect(row.attempts).toBe(1);
    expect(row.error_message).toBe(NOT_PUBLIC);
  });
});

async function settle() {
  // Delivery is fire and forget inside queueWebhookDelivery.
  await vi.waitFor(() => expect(createServerClientMock.mock.calls.length).toBeGreaterThanOrEqual(1));
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  sentBodies.length = 0;
  requestMock.mockReset();
  lookupMock.mockReset();
  createServerClientMock.mockReset();
  lookupMock.mockResolvedValue(PUBLIC);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('fetch must not be used for webhooks'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('MSP sendTestWebhook', () => {
  it.each([
    ['loopback', 'https://127.0.0.1/hook'],
    ['10.x', 'https://10.0.0.8/hook'],
    ['172.16.x', 'https://172.16.0.9/hook'],
    ['192.168.x', 'https://192.168.0.10/hook'],
    ['link-local metadata', 'https://169.254.169.254/latest/meta-data/'],
    ['100.64.x', 'https://100.64.1.1/hook'],
    ['::1', 'https://[::1]/hook'],
    ['fc00::/7', 'https://[fc00::1]/hook'],
    ['fe80::/10', 'https://[fe80::1]/hook'],
    ['IPv4-mapped IPv6 of a private address', 'https://[::ffff:10.0.0.8]/hook'],
  ])('refuses %s', async (_label, url) => {
    expect(await sendTestWebhook(webhook(url))).toEqual({ success: false, message: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname that resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.8', family: 4 }]);
    expect(await sendTestWebhook(webhook('https://intranet.example.com/hook'))).toEqual({ success: false, message: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname with one public and one private record', async () => {
    lookupMock.mockResolvedValue([...PUBLIC, { address: '192.168.0.10', family: 4 }]);
    expect(await sendTestWebhook(webhook('https://mixed.example.com/hook'))).toEqual({ success: false, message: NOT_PUBLIC });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('reports a 302 as a failure without following it', async () => {
    respond({ statusCode: 302, headers: { location: 'https://10.0.0.8/' }, body: BODY_MARKER });
    expect(await sendTestWebhook(webhook('https://hooks.example.com/hook'))).toEqual({
      success: false,
      message: 'HTTP 302: redirects are not followed',
      response_status: 302,
    });
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it('succeeds for a public host through the validated address', async () => {
    respond({ statusCode: 200, body: BODY_MARKER });
    expect(await sendTestWebhook(webhook('https://hooks.example.com/hook'))).toEqual({
      success: true,
      message: 'Test webhook delivered successfully',
      response_status: 200,
    });
    const options = requestMock.mock.calls[0][0];
    expect(options).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com', method: 'POST' });
    expect(options.headers).toMatchObject({ Host: 'hooks.example.com', 'X-Team': 'ops' });
    expect(options.headers['X-IntuneGet-Signature']).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 404, 500])('returns the status code and no response text for HTTP %i', async (statusCode) => {
    respond({ statusCode, body: BODY_MARKER });
    const result = await sendTestWebhook(webhook('https://hooks.example.com/hook'));
    expect(result).toEqual({ success: false, message: `HTTP ${statusCode}`, response_status: statusCode });
    expect(JSON.stringify(result)).not.toContain(BODY_MARKER);
  });
});

describe('MSP queued delivery', () => {
  it('records a refused destination as a failed attempt without sending', async () => {
    const updates = supabaseWith(webhook('https://169.254.169.254/latest/meta-data/'));
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'fixture' });
    await settle();

    expect(requestMock).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { table: 'msp_webhook_deliveries', values: expect.objectContaining({ attempts: 1, error_message: NOT_PUBLIC }) },
    ]);
  });

  it('records a redirect as a failed attempt and does not follow it', async () => {
    const updates = supabaseWith(webhook('https://hooks.example.com/hook'));
    respond({ statusCode: 307, headers: { location: 'https://10.0.0.8/' } });
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'fixture' });
    await settle();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(updates[0]).toEqual({
      table: 'msp_webhook_deliveries',
      values: expect.objectContaining({
        attempts: 1,
        response_status: 307,
        error_message: 'HTTP 307: redirects are not followed',
      }),
    });
  });

  it('delivers to a public host and records success', async () => {
    const updates = supabaseWith(webhook('https://hooks.example.com/hook'));
    respond({ statusCode: 200, body: 'accepted' });
    await queueWebhookDelivery('org-1', 'deployment.completed', { job: 'fixture' });
    await settle();

    expect(requestMock.mock.calls[0][0]).toMatchObject({ hostname: '93.184.216.34', servername: 'hooks.example.com' });
    expect(updates[0]).toEqual({
      table: 'msp_webhook_deliveries',
      values: expect.objectContaining({ status: 'success', attempts: 1, response_status: 200, response_body: 'accepted' }),
    });
    expect(updates[1]).toEqual({
      table: 'msp_webhook_configurations',
      values: expect.objectContaining({ failure_count: 0 }),
    });
  });
});
