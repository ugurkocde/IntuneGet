"use client";

import { useEffect } from "react";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

export default function RedirectPage() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch((error) => {
      console.error("Error broadcasting auth response:", error);
    });
  }, []);

  return null;
}
