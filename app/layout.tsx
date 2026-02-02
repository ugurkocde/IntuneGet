import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { MicrosoftAuthProvider } from "@/components/providers/MicrosoftAuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { MspProvider } from "@/contexts/MspContext";

// Analytics configuration
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const ANALYTICS_ENABLED = Boolean(PLAUSIBLE_DOMAIN);

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://intuneget.com"),
  title: "IntuneGet | Deploy Winget Apps to Intune",
  description:
    "Streamline your Microsoft Intune app deployment process with Winget integration. Package and upload applications effortlessly with automated deployment and cloud-native features.",
  keywords: [
    "Intune",
    "Winget",
    "App Deployment",
    "Microsoft Intune",
    "Cloud Deployment",
    "Enterprise Software",
    "Application Management",
  ],
  authors: [{ name: "Ugur Koc" }],
  creator: "Ugur Koc",
  publisher: "IntuneGet",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://intuneget.com",
    title: "IntuneGet - Simplify Your Intune App Deployment",
    description:
      "Streamline your Microsoft Intune app deployment process with Winget integration. Access 1000+ apps with automated deployment.",
    siteName: "IntuneGet",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "IntuneGet - Intune App Deployment Made Easy",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "IntuneGet - Simplify Your Intune App Deployment",
    description:
      "Streamline your Microsoft Intune app deployment process with Winget integration. Access 1000+ apps with automated deployment.",
    images: ["/og-image.png"],
    creator: "@ugurkoc",
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
  verification: {
    google: "verification_token",
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
    "IntuneGet streamlines Microsoft Intune app deployment with Winget integration. Package and upload applications effortlessly.",
  sameAs: ["https://github.com/ugurkocde/IntuneGet"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <QueryProvider>
      <MicrosoftAuthProvider>
        <MspProvider>
          {children}
          <Toaster />
        </MspProvider>
      </MicrosoftAuthProvider>
    </QueryProvider>
  );

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd),
          }}
        />
        {ANALYTICS_ENABLED && PLAUSIBLE_DOMAIN && (
          <Script
            defer
            data-domain={PLAUSIBLE_DOMAIN}
            src="https://plausible.io/js/script.js"
            strategy="afterInteractive"
          />
        )}
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        {content}
      </body>
    </html>
  );
}
