"use client";

import { useSyncExternalStore } from "react";

const AUTH_HINT_COOKIE = "msal-auth-hint";
const AUTH_HINT_EVENT = "intuneget:auth-hint-change";

/**
 * Call after writing or clearing the msal-auth-hint cookie so useAuthHint
 * consumers re-read it immediately (e.g. when MicrosoftAuthProvider finds a
 * stale hint with no MSAL session behind it and clears the cookie).
 */
export function notifyAuthHintChanged(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(AUTH_HINT_EVENT));
}

function readAuthHint(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith(`${AUTH_HINT_COOKIE}=1`));
}

function subscribe(onChange: () => void): () => void {
  // The cookie changes on sign-in/sign-out (which navigate) and when
  // MicrosoftAuthProvider corrects a stale hint (which fires the event).
  // Re-checking on focus/visibility covers cross-tab sign-in without polling.
  window.addEventListener(AUTH_HINT_EVENT, onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener(AUTH_HINT_EVENT, onChange);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

/**
 * Lightweight "is the visitor signed in?" signal for public pages, read from
 * the msal-auth-hint cookie that sign-in/sign-out maintain (also used by
 * proxy.ts to guard /dashboard). Unlike useMicrosoftAuth this does not pull
 * @azure/msal-browser into the bundle, which keeps MSAL off the marketing
 * pages entirely for anonymous visitors.
 *
 * Server-side this renders as signed-out; the client corrects it after
 * hydration. Treat it as a UI hint only, never as an authorization check.
 */
export function useAuthHint(): boolean {
  return useSyncExternalStore(subscribe, readAuthHint, () => false);
}
