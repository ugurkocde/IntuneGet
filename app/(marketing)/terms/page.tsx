import { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { T } from "gt-next";

export const metadata: Metadata = {
  title: "Terms of Use | IntuneGet",
  description:
    "Terms of Use for IntuneGet - the Winget to Intune deployment tool.",
  alternates: {
    canonical: "https://intuneget.com/terms",
  },
  openGraph: {
    title: "Terms of Use | IntuneGet",
    description:
      "Terms of Use for IntuneGet - the Winget to Intune deployment tool.",
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
      name: "Terms of Use",
      item: "https://intuneget.com/terms",
    },
  ],
};

export default function TermsPage() {
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
              <T>Terms of Use</T>
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              <T>Effective: January 24, 2026</T>
            </p>
          </div>

          <p className="text-text-secondary leading-relaxed">
            <T>
              These Terms of Use (&quot;Terms&quot;) govern your access to and use
              of IntuneGet (the &quot;Service&quot;). By using the Service, you
              agree to these Terms.
            </T>
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Access and Eligibility</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  You must have authority to access your Microsoft tenant and
                  Intune data.
                </T>
              </li>
              <li>
                <T>
                  You are responsible for complying with your organization&apos;s
                  policies and applicable laws.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Use of the Service</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  The Service requests Microsoft Graph permissions to retrieve
                  Winget package information and upload applications to your
                  Intune environment.
                </T>
              </li>
              <li>
                <T>
                  Applications are packaged and deployed based on your
                  configuration choices.
                </T>
              </li>
              <li>
                <T>
                  Do not misuse the Service (e.g., attempt to bypass security,
                  reverse engineer, or overload it).
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Privacy</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                Your use of the Service is also governed by our{" "}
                <Link
                  href="/privacy"
                  className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                >
                  Privacy Policy
                </Link>
                , which explains what we access and how we handle data.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Disclaimer</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                The Service is provided on an &quot;as is&quot; and &quot;as
                available&quot; basis without warranties of any kind. We do not
                warrant that the Service is error-free, complete, or suitable for
                any particular purpose. Validate outputs and deployments against
                your tenant as needed.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Limitation of Liability</T>
            </h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                To the maximum extent permitted by law, we shall not be liable for
                any indirect, incidental, special, consequential, or punitive
                damages, or any loss of data, profits, or revenues resulting from
                your use of the Service.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Changes</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                We may modify these Terms to reflect improvements or changes to
                the Service. Continued use constitutes acceptance of the updated
                Terms.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary"><T>Contact</T></h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                Questions about these Terms? Contact us at:{" "}
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
