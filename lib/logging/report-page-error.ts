import { safeDigest, type PageErrorArea } from './page-error-report';
let reports = 0;
export function reportPageError(area: PageErrorArea, digest?: string): void {
  if (reports >= 3) return;
  reports++;
  const validDigest = safeDigest(digest);
  try {
    void fetch('/api/diagnostics/page-error', {
      method: 'POST', keepalive: true, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'page_error', area, ...(validDigest ? { digest: validDigest } : {}) }),
    }).catch(() => {});
  } catch { /* error recovery must remain usable when reporting fails */ }
}
