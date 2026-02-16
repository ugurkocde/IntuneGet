import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { MicrosoftAuthProvider } from "@/components/providers/MicrosoftAuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { UserSettingsProvider } from "@/components/providers/UserSettingsProvider";
import { MspProvider } from "@/contexts/MspContext";
import { CookieConsentBanner } from '@/components/consent/CookieConsentBanner';
import { PlausibleLoader } from '@/components/analytics/PlausibleLoader';

// Analytics configuration
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.woff2",
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://intuneget.com"),
  title: "IntuneGet | Free Intune App Deployment Tool - Deploy 10,000+ Winget Apps",
  description:
    "Deploy 10,000+ Winget apps to Microsoft Intune in minutes. Free, open-source tool. No scripting, no IntuneWin packaging. Trusted by IT teams worldwide.",
  keywords: [
    "Intune app deployment",
    "Winget Intune",
    "free Intune deployment tool",
    "Microsoft Intune",
    "Intune app packaging",
    "Winget to Intune",
    "Intune application management",
    "deploy apps to Intune",
    "open source Intune tool",
    "IntuneWin alternative",
    "enterprise app deployment",
    "Intune automation",
  ],
  authors: [{ name: "Ugur Koc", url: "https://github.com/ugurkocde" }],
  creator: "Ugur Koc",
  publisher: "IntuneGet",
  alternates: {
    canonical: "https://intuneget.com",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://intuneget.com",
    title: "IntuneGet - Deploy 10,000+ Winget Apps to Intune for Free",
    description:
      "Deploy 10,000+ Winget apps to Microsoft Intune in minutes. Free, open-source tool with no scripting required.",
    siteName: "IntuneGet",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "IntuneGet - Free Intune App Deployment Tool for 10,000+ Winget Apps",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "IntuneGet - Deploy 10,000+ Winget Apps to Intune for Free",
    description:
      "Deploy 10,000+ Winget apps to Microsoft Intune in minutes. Free, open-source tool with no scripting required.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/logo-192.png", type: "image/png", sizes: "192x192" },
      { url: "/logo-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Organization JSON-LD structured data
const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "IntuneGet",
  url: "https://intuneget.com",
  logo: "https://intuneget.com/logo-512.png",
  description:
    "IntuneGet is the leading free, open-source tool for deploying Winget applications to Microsoft Intune. Deploy 10,000+ apps in minutes with no scripting required.",
  sameAs: ["https://github.com/ugurkocde/IntuneGet", "https://intunebrew.com"],
  founder: {
    "@type": "Person",
    name: "Ugur Koc",
    url: "https://ugurlabs.com",
    sameAs: [
      "https://github.com/ugurkocde",
      "https://www.linkedin.com/in/ugurkocde/",
    ],
    jobTitle: "Software Engineer & IT Automation Expert",
    knowsAbout: [
      "Microsoft Intune",
      "Endpoint Management",
      "Application Deployment",
      "IT Automation",
      "Winget",
    ],
  },
};

// Person JSON-LD for E-E-A-T signals
const personJsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Ugur Koc",
  url: "https://ugurlabs.com",
  sameAs: [
    "https://github.com/ugurkocde",
    "https://www.linkedin.com/in/ugurkocde/",
  ],
  jobTitle: "Software Engineer & IT Automation Expert",
  knowsAbout: [
    "Microsoft Intune",
    "Endpoint Management",
    "Application Deployment",
    "IT Automation",
    "Winget",
  ],
};

// WebSite JSON-LD with SearchAction for sitelinks search box
const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "IntuneGet",
  url: "https://intuneget.com",
  description:
    "Free, open-source Intune app deployment tool. Deploy 10,000+ Winget apps to Microsoft Intune in minutes.",
  publisher: {
    "@type": "Organization",
    name: "IntuneGet",
  },
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: "https://intuneget.com/dashboard?search={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <QueryProvider>
      <MicrosoftAuthProvider>
        <UserSettingsProvider>
              <ThemeProvider>
                <MspProvider>
                  {children}
                  <PlausibleLoader domain={PLAUSIBLE_DOMAIN} />
                  <CookieConsentBanner plausibleDomain={PLAUSIBLE_DOMAIN} />
                  <Toaster />
                </MspProvider>
              </ThemeProvider>
            </UserSettingsProvider>
          </MicrosoftAuthProvider>
        </QueryProvider>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://plausible.io" />
        <link rel="dns-prefetch" href="https://api.github.com" />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__RUNTIME_CONFIG__=${JSON.stringify({
              NEXT_PUBLIC_AZURE_AD_CLIENT_ID:
                process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID || "",
            })}`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => {
  try {
    const storedTheme = localStorage.getItem("intuneget-theme");
    if (storedTheme === "light" || storedTheme === "dark") {
      document.documentElement.classList.toggle("dark", storedTheme === "dark");
      return;
    }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", prefersDark);
  } catch (error) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("Failed to initialize theme preference:", error);
    }
  }
})();`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(personJsonLd),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd),
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {content}
      </body>
    </html>
  );
}
