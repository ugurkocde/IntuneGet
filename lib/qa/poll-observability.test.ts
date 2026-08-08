import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emitQaPollAlert,
  qaPollRunStatus,
  type QaPollAlertPayload,
  type QaPollSummary,
} from './poll-observability';

const summary: QaPollSummary = {
  checked: 6,
  updatesFound: 1,
  queued: 1,
  alreadyKnown: 5,
  unavailable: 0,
  errorCount: 1,
  errors: ['Example.App: upstream unavailable'],
};

const payload: QaPollAlertPayload = {
  runId: 'run-1',
  requestId: 'fra1::request-1',
  status: 'partial',
  startedAt: '2026-08-08T01:01:17.000Z',
  durationMs: 1_234,
  recipeCount: 6,
  summary,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('qaPollRunStatus', () => {
  it('uses the full error count rather than the sampled error list', () => {
    expect(qaPollRunStatus({ ...summary, errorCount: 2, errors: [] })).toBe('partial');
    expect(qaPollRunStatus({ ...summary, errorCount: 0, errors: [] })).toBe('succeeded');
  });
});

describe('emitQaPollAlert', () => {
  it('always emits a structured Vercel error log without configured destinations', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendEmail = vi.fn();
    const fetch = vi.fn();

    const result = await emitQaPollAlert(
      payload,
      { email: null, webhookUrl: null, webhookBearerToken: null },
      { sendEmail, fetch }
    );

    expect(result).toEqual({
      vercelLog: 'emitted',
      email: 'not_configured',
      webhook: 'not_configured',
      failures: [],
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.parse(String(consoleError.mock.calls[0][0]))).toMatchObject({
      level: 'error',
      message: 'qa_poll_requires_attention',
      runId: 'run-1',
      errorCount: 1,
    });
  });

  it('delivers configured email and webhook alerts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendEmail = vi.fn().mockResolvedValue({ success: true, messageId: 'email-1' });
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const result = await emitQaPollAlert(
      payload,
      {
        email: 'ops@example.com',
        webhookUrl: 'https://alerts.example.com/qa',
        webhookBearerToken: 'secret-token',
      },
      { sendEmail, fetch }
    );

    expect(result).toEqual({
      vercelLog: 'emitted',
      email: 'sent',
      webhook: 'sent',
      failures: [],
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'ops@example.com',
        subject: '[IntuneGet QA] WinGet poll partial',
      })
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://alerts.example.com/qa'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-token',
        },
      })
    );
  });

  it('records alert delivery failures without hiding the poll failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sendEmail = vi.fn().mockResolvedValue({ success: false, error: 'rate limited' });
    const fetch = vi.fn();

    const result = await emitQaPollAlert(
      payload,
      {
        email: 'ops@example.com',
        webhookUrl: 'http://alerts.example.com/qa',
        webhookBearerToken: null,
      },
      { sendEmail, fetch }
    );

    expect(result.email).toBe('failed');
    expect(result.webhook).toBe('failed');
    expect(result.failures).toEqual(
      expect.arrayContaining([
        'webhook: QA_ALERT_WEBHOOK_URL must use HTTPS',
        'email: rate limited',
      ])
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});
