import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// Shared by all requests in a job. Covers one hourly quota reset, with a
// bounded allowance for secondary limits. Workflow timeouts leave headroom.
export const GITHUB_RATE_LIMIT_WAIT_MS = 65 * 60_000;

/** Separate gh --include headers without decoding binary evidence archives. */
function responseParts(output) {
  let body = Buffer.isBuffer(output) ? output : Buffer.from(output || '');
  let status = 0;
  let headers = new Map();
  while (/^HTTP\/\S+ \d{3}/.test(body.subarray(0, 32).toString())) {
    const crlf = body.indexOf('\r\n\r\n');
    const lf = body.indexOf('\n\n');
    const end = crlf >= 0 && (lf < 0 || crlf < lf) ? crlf : lf;
    if (end < 0 || end > 65_536) break;
    const lines = body.subarray(0, end).toString('utf8').split(/\r?\n/);
    status = Number(lines.shift().split(' ')[1]);
    headers = new Map(lines.map(line => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    body = body.subarray(end + (end === crlf ? 4 : 2));
  }
  return { status, headers, body };
}

function rateLimitDelay(response, stderr, now, retry) {
  const { status, headers, body } = response;
  if (status !== 403 && status !== 429) return null;
  const remaining = headers.get('x-ratelimit-remaining');
  const retryAfter = headers.get('retry-after');
  if (status !== 429 && remaining !== '0' && !retryAfter &&
      !/(?:rate limit|abuse detection)/i.test(`${body.toString('utf8')} ${stderr}`)) return null;

  // Respect both headers if GitHub supplies both; never clamp a server's
  // reset time to our budget and retry before the quota actually resets.
  const reset = remaining === '0' ? Number(headers.get('x-ratelimit-reset')) * 1000 : NaN;
  const after = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
    ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter || '');
  const wait = Math.max(0, Number.isFinite(reset) ? reset - now : 0, Number.isFinite(after) ? after - now : 0);
  return wait > 0 ? wait + 1000 : 60_000 * 2 ** retry;
}

/**
 * Retry only explicit GitHub quota rejections, including rejected writes.
 * Network errors, 5xx responses and permission failures are not replayed:
 * a write may already have succeeded when its response was lost.
 */
export function createCuratedGitHubClient({
  tokenFor,
  spawn = spawnSync,
  wait = sleep,
  now = Date.now,
  log = console.warn,
  maxRetries = 3,
  maxTotalWaitMs = GITHUB_RATE_LIMIT_WAIT_MS,
} = {}) {
  let totalWaitMs = 0;
  return async function gh(args, { input, raw = false, optional = false } = {}) {
    const env = { ...process.env, GH_TOKEN: tokenFor ? tokenFor(args) : process.env.GH_TOKEN };
    const label = args.slice(0, 3).map(arg => arg.split('?')[0]).join(' ');
    for (let retry = 0; ; retry++) {
      const result = spawn('gh', [...args, '--include'], {
        input, encoding: null, maxBuffer: 16_777_216, timeout: 120_000, env,
      });
      const response = responseParts(result.stdout);
      if (result.status === 0) {
        if (raw) return response.body;
        const text = response.body.toString('utf8').trim();
        return text ? JSON.parse(text) : null;
      }
      const stderr = String(result.stderr || '');
      const delay = result.status === 1 ? rateLimitDelay(response, stderr, now(), retry) : null;
      if (delay !== null) {
        if (retry >= maxRetries || delay > maxTotalWaitMs - totalWaitMs) {
          throw new Error(`GitHub rate limit retry budget exhausted: ${label}. Next permitted attempt no earlier than ${new Date(now() + delay).toISOString()}.`);
        }
        totalWaitMs += delay;
        log(`GitHub rate limited ${label}; retry ${retry + 1}/${maxRetries} at ${new Date(now() + delay).toISOString()} (waiting ${Math.ceil(delay / 1000)}s).`);
        // Short sleeps keep the process interruptible during an hourly reset.
        for (let left = delay; left > 0; left -= 60_000) await wait(Math.min(left, 60_000));
        continue;
      }
      if (optional) return null;
      const detail = stderr.split('\n').find(line => line.trim()) || result.error?.message || 'no detail';
      throw new Error(`GitHub request failed: ${label} (${detail.trim().slice(0, 200)})`);
    }
  };
}
