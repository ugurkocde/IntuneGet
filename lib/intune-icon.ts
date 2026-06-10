/**
 * Shared helpers for attaching app icons to Intune apps.
 * Used by the Store app deployment path and the Win32 direct-upload path.
 */

import type { MimeContent } from '@/types/intune';

/** Graph rejects large icons; skip anything bigger than this before buffering */
export const MAX_ICON_BYTES = 1_048_576;

/**
 * Download an icon from a URL and return it as a Graph API MimeContent object.
 * Returns null if the URL is missing, not HTTPS, too large, or the download fails.
 */
export async function fetchIconAsBase64(
  iconUrl: string | undefined
): Promise<MimeContent | null> {
  if (!iconUrl || !iconUrl.startsWith('https://')) return null;

  try {
    const response = await fetch(iconUrl);
    if (!response.ok) return null;

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_ICON_BYTES) return null;

    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_ICON_BYTES) return null;
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return {
      '@odata.type': '#microsoft.graph.mimeContent',
      type: contentType.split(';')[0].trim(),
      value: base64,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve an icon path to an absolute URL.
 * Absolute http(s) URLs are returned as-is. Relative paths (e.g. /icons/<id>/)
 * are treated as directories: a trailing slash is ensured and icon-256.png is
 * appended (mirrors how the AppIcon component builds icon URLs), then the
 * result is resolved against NEXT_PUBLIC_URL, the browser origin, or the
 * production URL as a last resort.
 */
export function resolveIconUrl(iconPath: string | undefined): string | undefined {
  if (!iconPath) return undefined;
  if (iconPath.startsWith('http://') || iconPath.startsWith('https://')) {
    return iconPath;
  }

  const base = (
    process.env.NEXT_PUBLIC_URL ||
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    'https://www.intuneget.com'
  ).replace(/\/$/, '');

  const directory = iconPath.startsWith('/') ? iconPath : `/${iconPath}`;
  return `${base}${directory.replace(/\/?$/, '/')}icon-256.png`;
}
