"use client";

import { MsalProvider, useMsal } from "@azure/msal-react";
import { InteractionStatus, EventType } from "@azure/msal-browser";
import { getMsalInstance } from "@/lib/msal-config";
import { notifyAuthHintChanged } from "@/hooks/useAuthHint";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

// One owner for session side effects, independent of useMicrosoftAuth consumers.
function AuthSession() {
  const { instance, accounts, inProgress } = useMsal();
  const tracked = useRef<string | null>(null);
  const method = useRef('silent');
  useEffect(() => {
    const callback = instance.addEventCallback(event => {
      if (event.eventType === EventType.LOGIN_SUCCESS) method.current = event.interactionType || 'silent';
    });
    return () => { if (callback) instance.removeEventCallback(callback); };
  }, [instance]);
  useEffect(() => {
    if (inProgress !== InteractionStatus.None) return;
    const account = instance.getActiveAccount() ?? accounts[0];
    document.cookie = account
      ? "msal-auth-hint=1; path=/; SameSite=Lax; max-age=86400"
      : "msal-auth-hint=; path=/; SameSite=Lax; max-age=0";
    notifyAuthHintChanged();
    if (!account) {
      tracked.current = null;
      method.current = 'silent';
      return;
    }
    if (!instance.getActiveAccount()) instance.setActiveAccount(account);
    const key = `${account.homeAccountId}:${account.tenantId}`;
    if (tracked.current === key) return;
    tracked.current = key;
    void fetch('/api/auth/track-signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: account.localAccountId,
        email: account.username,
        name: account.name || null,
        tenantId: account.tenantId,
        authMethod: method.current,
      }),
    }).catch(() => { /* Logging must never block authentication. */ });
  }, [instance, accounts, inProgress]);
  return null;
}

function AuthenticatedProvider({ children }: { children: ReactNode }) {
  // MsalProvider owns initialization. Keep its position stable so initialization
  // does not remount forms and repeat dashboard mount effects.
  const [instance] = useState(getMsalInstance);
  return (
    <MsalProvider instance={instance}>
      <AuthSession />
      {children}
    </MsalProvider>
  );
}

export function MicrosoftAuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // MSAL v5 redirect bridge must run outside MsalProvider.
  if (pathname === '/redirect') return <>{children}</>;
  return <AuthenticatedProvider>{children}</AuthenticatedProvider>;
}
