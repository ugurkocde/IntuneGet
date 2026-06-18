import { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { T } from "gt-next";

export const metadata: Metadata = {
  title: "Privacy Policy | IntuneGet",
  description:
    "Privacy Policy for IntuneGet - learn how we handle your data when using the Winget to Intune deployment tool.",
  alternates: {
    canonical: "https://intuneget.com/privacy",
  },
  openGraph: {
    title: "Privacy Policy | IntuneGet",
    description:
      "Privacy Policy for IntuneGet - learn how we handle your data when using the Winget to Intune deployment tool.",
  },
};

const breadcrumbJsonLd = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://intuneget.com",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Privacy Policy",
      item: "https://intuneget.com/privacy",
    },
  ],
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Content */}
      <main className="flex-1 mx-auto max-w-4xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
              <T>Privacy Policy</T>
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              <T>Effective: January 24, 2026</T>
            </p>
          </div>

          <p className="text-text-secondary leading-relaxed">
            <T>
              This Privacy Policy explains how IntuneGet (&quot;we&quot;,
              &quot;our&quot;, or &quot;the Service&quot;) handles information
              when you use the app to package and deploy applications from Winget
              to Microsoft Intune. We designed the Service to minimize data
              collection and focus on privacy by default.
            </T>
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>What We Access</T></h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <strong className="text-text-primary">
                  <T>Authentication via Microsoft OAuth 2.0 (Azure AD).</T>
                </strong>{" "}
                <T>
                  We request Microsoft Graph permissions necessary to upload
                  applications to your Intune environment.
                </T>
              </li>
              <li>
                <strong className="text-text-primary">
                  <T>Intune application data.</T>
                </strong>{" "}
                <T>
                  We access the permissions required to upload Win32 applications
                  to your Intune tenant.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>How We Process Data</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  We do not persist your Intune configuration data beyond what is
                  necessary for the application upload process.
                </T>
              </li>
              <li>
                <T>
                  Access tokens are managed by your browser session to call
                  Microsoft Graph; we do not persist them server-side.
                </T>
              </li>
              <li>
                <T>
                  Package metadata and upload history may be stored locally in
                  your self-hosted database.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Data Location &amp; Hosting</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  The hosted version (intuneget.com) stores its data in the
                  European Union, in Supabase&apos;s Frankfurt, Germany region
                  (eu-central-1).
                </T>
              </li>
              <li>
                <T>
                  We store only the operational metadata needed to run the
                  service, for example your account email, deployment history,
                  app catalog, team and organization settings, and audit logs.
                  We do not store application installers or your Intune
                  credentials.
                </T>
              </li>
              <li>
                <T>
                  The web application is served over TLS through Vercel&apos;s
                  global edge network, and application packaging runs on
                  temporary, ephemeral GitHub-hosted runners.
                </T>
              </li>
              <li>
                <T>
                  If you require data to remain entirely within your own
                  infrastructure or a specific region, you can self-host
                  IntuneGet with an embedded SQLite database.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Analytics & Cookies</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  We use privacy-friendly analytics (Plausible) to understand
                  aggregate usage without cookies or personal identifiers.
                </T>
              </li>
              <li>
                <T>
                  Plausible Analytics is 100% cookieless and does not track
                  personal data or use browser fingerprinting.
                </T>
              </li>
              <li>
                <T>
                  We collect only aggregated, anonymous metrics such as page
                  views, referrers, and device types.
                </T>
              </li>
              <li>
                <T>
                  Your consent choice is managed by the cookie banner and stored in
                  localStorage (not a cookie) and remains on your device only.
                </T>
              </li>
              <li>
                <T>
                  You can revisit this page anytime to review what enabling or
                  disabling analytics changes.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Data Sharing</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                We do not sell or share your configuration data with third
                parties. Data accessed from Microsoft Graph is used solely to
                facilitate application deployment to your Intune environment.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Security</T></h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  Authentication is handled via Microsoft OAuth 2.0 (Azure AD).
                </T>
              </li>
              <li>
                <T>
                  Only the required Graph permissions are requested for Intune
                  operations.
                </T>
              </li>
              <li>
                <T>
                  For self-hosted deployments, you maintain full control over your
                  data and infrastructure.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Data Retention</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                We do not retain your Intune configuration data beyond the active
                session. Operational logs may exist temporarily within hosting
                provider systems as part of standard logging.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Your Choices</T></h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  You can disconnect at any time by signing out of the app.
                </T>
              </li>
              <li>
                <T>
                  You can revoke the app&apos;s permissions from your Microsoft
                  account/tenant to prevent future access.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Children&apos;s Privacy</T>
            </h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                The Service is intended for professional/enterprise use and is not
                directed to children.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Changes</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                We may update this policy to reflect improvements or operational
                changes. If we make material changes, we will update the effective
                date above.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Contact</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                Questions about this policy? Contact us at:{" "}
                <a
                  href="mailto:support@ugurlabs.com"
                  className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                >
                  support@ugurlabs.com
                </a>
              </T>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
