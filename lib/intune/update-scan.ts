import { fetchWithRetry } from '@/lib/intune/graph-client';
import type { IntuneWin32App } from '@/types/inventory';

export class UpdateScanUnavailable extends Error {
  constructor() { super('The update scan could not finish. Please try again shortly.'); }
}

export class UpdateScanGraphError extends Error {
  constructor(readonly status: number) { super('Microsoft Graph rejected the update scan request.'); }
}

/** Fail before the function deadline. Read-only work may finish in the background. */
export async function withinUpdateScanBudget<T>(work: Promise<T>, deadlineAt: number): Promise<T> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new UpdateScanUnavailable();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new UpdateScanUnavailable()), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function fetchUpdateInventory(token: string, deadlineAt: number): Promise<IntuneWin32App[]> {
  const apps: IntuneWin32App[] = [];
  const seen = new Set<string>();
  let nextUrl: string | null = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')&$top=100";
  while (nextUrl) {
    const url = new URL(nextUrl);
    if (url.origin !== 'https://graph.microsoft.com' || url.pathname !== '/beta/deviceAppManagement/mobileApps' ||
        url.username || url.password || seen.has(url.href) || seen.size >= 200 || Date.now() >= deadlineAt) {
      throw new UpdateScanUnavailable();
    }
    seen.add(url.href);
    const response = await fetchWithRetry(url.href, {
      headers: {Authorization:'Bearer '+token,'Content-Type':'application/json'},
      signal: AbortSignal.timeout(Math.max(1, deadlineAt - Date.now())),
    }, 2, deadlineAt);
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) throw new UpdateScanUnavailable();
      throw new UpdateScanGraphError(response.status);
    }
    const page = await response.json();
    if (!Array.isArray(page.value)) throw new UpdateScanUnavailable();
    apps.push(...page.value);
    nextUrl = page['@odata.nextLink'] || null;
  }
  return apps;
}

/** Bound DB matching concurrency while preserving inventory order. */
export async function mapUpdateApps<T, R>(apps: T[], match: (app:T)=>Promise<R>, deadlineAt:number):Promise<R[]> {
  const result = new Array<R>(apps.length);
  let nextIndex = 0;
  let stopped = false;
  async function worker() {
    try {
      while (!stopped && nextIndex < apps.length) {
        if (Date.now() >= deadlineAt) throw new UpdateScanUnavailable();
        const index = nextIndex++;
        result[index] = await withinUpdateScanBudget(match(apps[index]), deadlineAt);
      }
    } catch (error) { stopped = true; throw error; }
  }
  await withinUpdateScanBudget(Promise.all(Array.from({length: Math.min(10, apps.length)}, worker)), deadlineAt);
  return result;
}
