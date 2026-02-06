"use client";

import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication } from "@azure/msal-browser";
import { getMsalInstance } from "@/lib/msal-config";
import { useEffect, useState, ReactNode } from "react";

interface MicrosoftAuthProviderProps {
  children: ReactNode;
}

export function MicrosoftAuthProvider({
  children,
}: MicrosoftAuthProviderProps) {
  const [msalInstance, setMsalInstance] =
    useState<PublicClientApplication | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initializeMsal = async () => {
      try {
        const instance = getMsalInstance();
        await instance.initialize();

        // Sync auth hint cookie for server-side middleware protection
        const accounts = instance.getAllAccounts();
        if (accounts.length > 0) {
          document.cookie = "msal-auth-hint=1; path=/; SameSite=Lax; max-age=86400";
        } else {
          document.cookie = "msal-auth-hint=; path=/; SameSite=Lax; max-age=0";
        }

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
