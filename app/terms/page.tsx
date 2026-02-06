import { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";

export const metadata: Metadata = {
  title: "Terms of Use | IntuneGet",
  description:
    "Terms of Use for IntuneGet - the Winget to Intune deployment tool.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />

      {/* Content */}
      <main className="flex-1 mx-auto max-w-4xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
              Terms of Use
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Effective: January 24, 2026
            </p>
          </div>

          <p className="text-text-secondary leading-relaxed">
            These Terms of Use (&quot;Terms&quot;) govern your access to and use
            of IntuneGet (the &quot;Service&quot;). By using the Service, you
            agree to these Terms.
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              Access and Eligibility
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                You must have authority to access your Microsoft tenant and
                Intune data.
              </li>
              <li>
                You are responsible for complying with your organization&apos;s
                policies and applicable laws.
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              Use of the Service
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                The Service requests Microsoft Graph permissions to retrieve
                Winget package information and upload applications to your
                Intune environment.
              </li>
              <li>
                Applications are packaged and deployed based on your
                configuration choices.
              </li>
              <li>
                Do not misuse the Service (e.g., attempt to bypass security,
                reverse engineer, or overload it).
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Privacy</h2>
            <p className="text-text-secondary leading-relaxed">
              Your use of the Service is also governed by our{" "}
              <Link
                href="/privacy"
                className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
              >
                Privacy Policy
              </Link>
              , which explains what we access and how we handle data.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Disclaimer</h2>
            <p className="text-text-secondary leading-relaxed">
              The Service is provided on an &quot;as is&quot; and &quot;as
              available&quot; basis without warranties of any kind. We do not
              warrant that the Service is error-free, complete, or suitable for
              any particular purpose. Validate outputs and deployments against
              your tenant as needed.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              Limitation of Liability
            </h2>
            <p className="text-text-secondary leading-relaxed">
              To the maximum extent permitted by law, we shall not be liable for
              any indirect, incidental, special, consequential, or punitive
              damages, or any loss of data, profits, or revenues resulting from
              your use of the Service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Changes</h2>
            <p className="text-text-secondary leading-relaxed">
              We may modify these Terms to reflect improvements or changes to
              the Service. Continued use constitutes acceptance of the updated
              Terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">Contact</h2>
            <p className="text-text-secondary leading-relaxed">
              Questions about these Terms? Contact us at:{" "}
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
