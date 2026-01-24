import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { MicrosoftAuthProvider } from "@/components/providers/MicrosoftAuthProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { MspProvider } from "@/contexts/MspContext";

// Analytics configuration
const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
const PLAUSIBLE_SCRIPT_URL = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL;
const ANALYTICS_ENABLED = Boolean(PLAUSIBLE_DOMAIN && PLAUSIBLE_SCRIPT_URL);

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {ANALYTICS_ENABLED && PLAUSIBLE_SCRIPT_URL && (
          <>
            <Script
              src={PLAUSIBLE_SCRIPT_URL}
              strategy="afterInteractive"
            />
            <Script id="plausible-init" strategy="afterInteractive">
              {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
            </Script>
          </>
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <QueryProvider>
          <MicrosoftAuthProvider>
            <MspProvider>
              {children}
              <Toaster />
            </MspProvider>
          </MicrosoftAuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
