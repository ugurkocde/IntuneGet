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
