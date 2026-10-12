import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePageErrorReport } from '@/lib/logging/page-error-report';
let POST: typeof import('./route').POST;
const body = { event: 'page_error', area: 'dashboard', digest: '12345' };
function request(value: unknown = body, headers: Record<string, string> = {}) {
  return new Request('https://test.invalid/api/diagnostics/page-error', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(value) });
}
beforeEach(async () => { vi.resetModules(); POST = (await import('./route')).POST; vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('minimal page diagnostic', () => {
  it('accepts fixed data only and logs no request data', async () => {
    const response = await POST(request()); expect(response.status).toBe(204); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(console.error).toHaveBeenCalledWith('[page-error] area=dashboard digest=12345');
  });
  it.each([{ event: 'page_error', area: 'root' }, body])('accepts with or without a digest', async value => { expect((await POST(request(value))).status).toBe(204); });
  it.each([{ ...body, path: '/private' }, { ...body, digest: 'secret' }, { ...body, area: 'tenant' }, { event: 'other', area: 'root' }, null, []])('rejects invalid data %s', async value => {
    expect((await POST(request(value))).status).toBe(400); expect(console.error).not.toHaveBeenCalled();
  });
  it('rejects cross site, missing metadata and wrong content type', async () => {
    expect((await POST(request(body, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await POST(request(body, { 'sec-fetch-site': '' }))).status).toBe(403);
    expect((await POST(request(body, { 'content-type': 'text/plain' }))).status).toBe(415);
  });
  it('rejects both declared and streamed oversized bodies', async () => {
    expect((await POST(request(body, { 'content-length': '1025' }))).status).toBe(413);
    expect((await POST(request({ ...body, padding: 'x'.repeat(1025) }))).status).toBe(413);
  });
  it('caps a process at five reports and summarizes suppression', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T01:00:00Z'));
    for (let i = 0; i < 5; i++) expect((await POST(request())).status).toBe(204);
    expect((await POST(request())).status).toBe(429); expect(console.error).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(60_000); expect((await POST(request())).status).toBe(204);
    expect(console.error).toHaveBeenCalledWith('[page-error] suppressed 1 reports');
  });
  it('rejects malformed JSON and empty bodies', async () => {
    const headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
    expect((await POST(new Request('https://test.invalid', { method: 'POST', headers, body: '{' }))).status).toBe(400);
    expect((await POST(new Request('https://test.invalid', { method: 'POST', headers }))).status).toBe(400);
  });
  it('validates the digest without accepting opaque identifiers', () => {
    expect(validatePageErrorReport({ ...body, digest: '1'.repeat(21) })).toBeNull();
    expect(validatePageErrorReport({ ...body, digest: 123 })).toBeNull();
  });
  it('bounds an unfinished request body without logging it', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } });
    const input = new Request('https://test.invalid', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: stream, duplex: 'half' } as RequestInit);
    const response = POST(input);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await response).status).toBe(408);
    expect(console.error).not.toHaveBeenCalled();
  });
});
