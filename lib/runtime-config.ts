/**
 * Runtime configuration helper for Docker/self-hosted deployments.
 *
 * Next.js inlines NEXT_PUBLIC_* env vars at build time, which means they are
 * empty when the Docker image is built without them. This module reads from
 * window.__RUNTIME_CONFIG__ (injected by layout.tsx at request time) first,
 * then falls back to process.env for Vercel / dev builds where the value is
 * already inlined correctly.
 */

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      NEXT_PUBLIC_AZURE_AD_CLIENT_ID?: string;
    };
  }
}

export function getPublicClientId(): string {
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.NEXT_PUBLIC_AZURE_AD_CLIENT_ID) {
    return window.__RUNTIME_CONFIG__.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  }
  return process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID || "";
}
