import { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";

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
              Privacy Policy
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Effective: January 24, 2026
            </p>
          </div>

          <p className="text-text-secondary leading-relaxed">
            This Privacy Policy explains how IntuneGet (&quot;we&quot;,
            &quot;our&quot;, or &quot;the Service&quot;) handles information
            when you use the app to package and deploy applications from Winget
            to Microsoft Intune. We designed the Service to minimize data
            collection and focus on privacy by default.
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">What We Access</h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <strong className="text-text-primary">
                  Authentication via Microsoft OAuth 2.0 (Azure AD).
                </strong>{" "}
                We request Microsoft Graph permissions necessary to upload
                applications to your Intune environment.
              </li>
              <li>
                <strong className="text-text-primary">
                  Intune application data.
                </strong>{" "}
                We access the permissions required to upload Win32 applications
                to your Intune tenant.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              How We Process Data
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                We do not persist your Intune configuration data beyond what is
                necessary for the application upload process.
              </li>
              <li>
                Access tokens are managed by your browser session to call
                Microsoft Graph; we do not persist them server-side.
              </li>
              <li>
                Package metadata and upload history may be stored locally in
                your self-hosted database.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              Analytics & Cookies
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                We use privacy-friendly analytics (Plausible) to understand
                aggregate usage without cookies or personal identifiers.
              </li>
              <li>
                Plausible Analytics is 100% cookieless and does not track
                personal data or use browser fingerprinting.
              </li>
              <li>
                We collect only aggregated, anonymous metrics such as page
                views, referrers, and device types.
              </li>
              <li>
                Your consent choice is managed by the cookie banner and stored in
                localStorage (not a cookie) and remains on your device only.
              </li>
              <li>
                You can revisit this page anytime to review what enabling or
                disabling analytics changes.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Data Sharing</h2>
            <p className="text-text-secondary leading-relaxed">
              We do not sell or share your configuration data with third
              parties. Data accessed from Microsoft Graph is used solely to
              facilitate application deployment to your Intune environment.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Security</h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                Authentication is handled via Microsoft OAuth 2.0 (Azure AD).
              </li>
              <li>
                Only the required Graph permissions are requested for Intune
                operations.
              </li>
              <li>
                For self-hosted deployments, you maintain full control over your
                data and infrastructure.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Data Retention</h2>
            <p className="text-text-secondary leading-relaxed">
              We do not retain your Intune configuration data beyond the active
              session. Operational logs may exist temporarily within hosting
              provider systems as part of standard logging.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Your Choices</h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                You can disconnect at any time by signing out of the app.
              </li>
              <li>
                You can revoke the app&apos;s permissions from your Microsoft
                account/tenant to prevent future access.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              Children&apos;s Privacy
            </h2>
            <p className="text-text-secondary leading-relaxed">
              The Service is intended for professional/enterprise use and is not
              directed to children.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Changes</h2>
            <p className="text-text-secondary leading-relaxed">
              We may update this policy to reflect improvements or operational
              changes. If we make material changes, we will update the effective
              date above.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Contact</h2>
            <p className="text-text-secondary leading-relaxed">
              Questions about this policy? Contact us at:{" "}
              <a
                href="mailto:support@ugurlabs.com"
                className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
              >
                support@ugurlabs.com
              </a>
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
