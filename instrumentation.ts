import type { Instrumentation } from 'next';
import { safeDigest } from './lib/logging/page-error-report';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConsoleCapture } = await import('./lib/logging/node-register');
    installConsoleCapture();
  }
}
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  try {
    const digest = error && typeof error === 'object' && 'digest' in error ? safeDigest(error.digest) : undefined;
    // Only Next's route pattern, never the request URL, headers, message or stack.
    const route = context.routePath.replace(/[^A-Za-z0-9_\/()[\].@-]/g, '').slice(0, 160);
    const method = /^[A-Z]{1,12}$/.test(request.method) ? request.method : 'OTHER';
    console.error('[request-error] type=' + context.routeType + ' route=' + route + ' method=' + method + ' digest=' + (digest ?? 'none'));
  } catch { /* instrumentation must never break the failed request */ }
};
