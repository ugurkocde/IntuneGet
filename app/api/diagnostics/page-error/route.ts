import { validatePageErrorReport } from '@/lib/logging/page-error-report';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const LIMIT_BYTES = 1024;
let windowStart = 0, accepted = 0, suppressed = 0;
function reply(status: number) { return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return reply(403);
  if (!/^application\/json(?:\s*;\s*charset=[\w-]+)?$/i.test(request.headers.get('content-type') ?? '')) return reply(415);
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > LIMIT_BYTES)) return reply(413);
  let value: unknown, timedOut = false;
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    const chunks: Uint8Array[] = []; let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        void reader.cancel().catch(() => {});
        reject(new Error('Diagnostic body deadline'));
      }, 5000);
    });
    try {
      while (true) {
        const next = await Promise.race([reader.read(), deadline]);
        if (next.done) break;
        size += next.value.byteLength;
        if (size > LIMIT_BYTES) { void reader.cancel().catch(() => {}); return reply(413); }
        chunks.push(next.value);
      }
    } finally { clearTimeout(timer); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return reply(timedOut ? 408 : 400); }
  const report = validatePageErrorReport(value);
  if (!report) return reply(400);
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    if (suppressed) console.error('[page-error] suppressed ' + suppressed + ' reports');
    windowStart = now; accepted = 0; suppressed = 0;
  }
  if (accepted >= 5) { suppressed++; return reply(429); }
  accepted++;
  console.error('[page-error] area=' + report.area + ' digest=' + (report.digest ?? 'none'));
  return reply(204);
}
