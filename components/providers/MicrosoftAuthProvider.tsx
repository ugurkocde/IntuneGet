"use client";

import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { getMsalInstance } from "@/lib/msal-config";
import { notifyAuthHintChanged } from "@/hooks/useAuthHint";
import { useEffect, useState, ReactNode } from "react";
import { usePathname } from "next/navigation";

interface MicrosoftAuthProviderProps {
  children: ReactNode;
}

export function MicrosoftAuthProvider({
  children,
}: MicrosoftAuthProviderProps) {
  const pathname = usePathname();
  const [msalInstance, setMsalInstance] =
    useState<PublicClientApplication | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // The /redirect page handles MSAL v5 redirect bridge and must not be
  // wrapped in MsalProvider
  const isRedirectPage = pathname === "/redirect";

  useEffect(() => {
    if (isRedirectPage) {
      setIsInitialized(true);
      return;
    }
    const initializeMsal = async () => {
      try {
        const instance = getMsalInstance();
        await instance.initialize();

        // Sync auth hint cookie for server-side middleware protection
        const accounts = instance.getAllAccounts();
        if (accounts.length > 0) {
          // Ensure an active account is set for returning sessions so silent
          // token acquisition has a deterministic target across tabs/reloads.
          if (!instance.getActiveAccount()) {
            instance.setActiveAccount(accounts[0]);
          }
          document.cookie = "msal-auth-hint=1; path=/; SameSite=Lax; max-age=86400";
        } else {
          document.cookie = "msal-auth-hint=; path=/; SameSite=Lax; max-age=0";
        }
        // Let useAuthHint consumers (marketing Header) re-read the corrected
        // cookie right away instead of waiting for a focus/visibility event.
        notifyAuthHintChanged();

        setMsalInstance(instance);
        setIsInitialized(true);
      } catch (error) {
        console.error("Failed to initialize MSAL:", error);
        // Still render children even if MSAL fails to initialize
        setIsInitialized(true);
      }
    };

    initializeMsal();
  }, []);

  // Show children immediately, MSAL features will be available once initialized
  if (!isInitialized) {
    return <>{children}</>;
  }

  if (!msalInstance) {
    // MSAL failed to initialize, render without it
    return <>{children}</>;
  }

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}
