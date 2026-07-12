import { MicrosoftAuthProvider } from "@/components/providers/MicrosoftAuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { UserSettingsProvider } from "@/components/providers/UserSettingsProvider";
import { MspProvider } from "@/contexts/MspContext";

/**
 * Provider stack for the authenticated app surface (dashboard, apps, auth,
 * onboarding, msp, redirect). Kept out of the root layout so marketing and
 * docs pages don't ship MSAL, react-query, and the settings/MSP machinery to
 * anonymous visitors.
 */
export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <QueryProvider>
      <MicrosoftAuthProvider>
        <UserSettingsProvider>
          <ThemeProvider>
            <MspProvider>{children}</MspProvider>
          </ThemeProvider>
        </UserSettingsProvider>
      </MicrosoftAuthProvider>
    </QueryProvider>
  );
}
