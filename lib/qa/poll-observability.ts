import { sendEmail } from '@/lib/email/service';
import type { Json } from '@/types/database';

export type QaPollRunStatus = 'succeeded' | 'partial' | 'failed';

export interface QaPollSummary {
  checked: number;
  updatesFound: number;
  queued: number;
  alreadyKnown: number;
  unavailable: number;
  errorCount: number;
  errors: string[];
}

export interface QaPollAlertPayload {
  runId: string | null;
  requestId: string | null;
  status: Exclude<QaPollRunStatus, 'succeeded'>;
  startedAt: string;
  durationMs: number;
  recipeCount: number;
  summary: QaPollSummary;
}

export interface QaPollAlertConfig {
  email: string | null;
  webhookUrl: string | null;
  webhookBearerToken: string | null;
}

export interface QaPollAlertDelivery extends Record<string, Json> {
  vercelLog: 'emitted';
  email: 'not_configured' | 'sent' | 'failed';
  webhook: 'not_configured' | 'sent' | 'failed';
  failures: string[];
}

interface QaPollAlertDependencies {
  sendEmail: typeof sendEmail;
  fetch: typeof fetch;
}

const DEFAULT_DEPENDENCIES: QaPollAlertDependencies = {
  sendEmail,
  fetch,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function alertText(payload: QaPollAlertPayload): string {
  const lines = [
    `QA WinGet poll ${payload.status}`,
    `Run: ${payload.runId || 'not persisted'}`,
    `Request: ${payload.requestId || 'unknown'}`,
    `Started: ${payload.startedAt}`,
    `Duration: ${payload.durationMs} ms`,
    `Recipes: ${payload.recipeCount}`,
    `Checked: ${payload.summary.checked}`,
    `Updates found: ${payload.summary.updatesFound}`,
    `Queued: ${payload.summary.queued}`,
    `Already known: ${payload.summary.alreadyKnown}`,
    `Unavailable: ${payload.summary.unavailable}`,
    `Errors: ${payload.summary.errorCount}`,
  ];

  if (payload.summary.errors.length > 0) {
    lines.push('', ...payload.summary.errors.map((error) => `- ${error}`));
    if (payload.summary.errorCount > payload.summary.errors.length) {
      lines.push(
        `- ${payload.summary.errorCount - payload.summary.errors.length} additional error(s) are stored only as a count`
      );
    }
  }

  return lines.join('\n');
}

export function qaPollAlertConfigFromEnvironment(): QaPollAlertConfig {
  return {
    email: process.env.QA_ALERT_EMAIL?.trim() || null,
    webhookUrl: process.env.QA_ALERT_WEBHOOK_URL?.trim() || null,
    webhookBearerToken: process.env.QA_ALERT_WEBHOOK_BEARER_TOKEN?.trim() || null,
  };
}

export function qaPollRunStatus(summary: QaPollSummary): QaPollRunStatus {
  return summary.errorCount > 0 ? 'partial' : 'succeeded';
}

export function structuredQaPollLog(
  level: 'info' | 'error',
  message: string,
  context: Record<string, unknown>
): void {
  const entry = JSON.stringify({
    level,
    message,
    route: '/api/cron/qa-enqueue',
    ...context,
  });

  if (level === 'error') {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

export async function emitQaPollAlert(
  payload: QaPollAlertPayload,
  config: QaPollAlertConfig = qaPollAlertConfigFromEnvironment(),
  dependencies: QaPollAlertDependencies = DEFAULT_DEPENDENCIES
): Promise<QaPollAlertDelivery> {
  structuredQaPollLog('error', 'qa_poll_requires_attention', {
    runId: payload.runId,
    requestId: payload.requestId,
    status: payload.status,
    durationMs: payload.durationMs,
    recipeCount: payload.recipeCount,
    checked: payload.summary.checked,
    updatesFound: payload.summary.updatesFound,
    queued: payload.summary.queued,
    alreadyKnown: payload.summary.alreadyKnown,
    unavailable: payload.summary.unavailable,
    errorCount: payload.summary.errorCount,
    errors: payload.summary.errors,
  });

  const delivery: QaPollAlertDelivery = {
    vercelLog: 'emitted',
    email: config.email ? 'failed' : 'not_configured',
    webhook: config.webhookUrl ? 'failed' : 'not_configured',
    failures: [],
  };
  const text = alertText(payload);
  const deliveries: Promise<void>[] = [];

  if (config.email) {
    deliveries.push(
      dependencies
        .sendEmail({
          to: config.email,
          subject: `[IntuneGet QA] WinGet poll ${payload.status}`,
          text,
          html: `<pre style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap">${escapeHtml(text)}</pre>`,
        })
        .then((result) => {
          if (result.success) {
            delivery.email = 'sent';
            return;
          }
          delivery.failures.push(`email: ${result.error || 'delivery failed'}`);
        })
        .catch((error) => {
          delivery.failures.push(
            `email: ${error instanceof Error ? error.message : String(error)}`
          );
        })
    );
  }

  if (config.webhookUrl) {
    deliveries.push(
      (async () => {
        try {
          const url = new URL(config.webhookUrl!);
          if (url.protocol !== 'https:') {
            throw new Error('QA_ALERT_WEBHOOK_URL must use HTTPS');
          }
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (config.webhookBearerToken) {
            headers.Authorization = `Bearer ${config.webhookBearerToken}`;
          }
          const response = await dependencies.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ event: 'qa.poll.requires_attention', ...payload }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          delivery.webhook = 'sent';
        } catch (error) {
          delivery.failures.push(
            `webhook: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })()
    );
  }

  await Promise.all(deliveries);

  if (delivery.failures.length > 0) {
    structuredQaPollLog('error', 'qa_poll_alert_delivery_failed', {
      runId: payload.runId,
      requestId: payload.requestId,
      failures: delivery.failures,
    });
  }

  return delivery;
}
