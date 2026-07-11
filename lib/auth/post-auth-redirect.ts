const DEFAULT_REDIRECT = '/dashboard';
const STORAGE_KEY = 'intuneget_post_auth_redirect';
const MAX_AGE_MS = 60 * 60 * 1000;

interface StoredRedirect {
  path: string;
  savedAt: number;
}

export function getSafeInternalRedirect(
  value: string | null | undefined,
  fallback = DEFAULT_REDIRECT,
): string {
  const safeFallback =
    fallback.startsWith('/') && !fallback.startsWith('//') && !fallback.includes('\\')
      ? fallback
      : DEFAULT_REDIRECT;

  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return safeFallback;
  }

  try {
    const base = 'https://intuneget.local';
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return safeFallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return safeFallback;
  }
}

export function rememberPostAuthRedirect(value: string): void {
  if (typeof window === 'undefined') return;

  const path = getSafeInternalRedirect(value);
  const stored: StoredRedirect = { path, savedAt: Date.now() };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function readPostAuthRedirect(fallback = DEFAULT_REDIRECT): string {
  if (typeof window === 'undefined') return getSafeInternalRedirect(fallback);

  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return getSafeInternalRedirect(fallback);

  try {
    const stored = JSON.parse(raw) as Partial<StoredRedirect>;
    if (
      typeof stored.path !== 'string' ||
      typeof stored.savedAt !== 'number' ||
      Date.now() - stored.savedAt > MAX_AGE_MS
    ) {
      sessionStorage.removeItem(STORAGE_KEY);
      return getSafeInternalRedirect(fallback);
    }

    return getSafeInternalRedirect(stored.path, fallback);
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return getSafeInternalRedirect(fallback);
  }
}

export function clearPostAuthRedirect(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}
