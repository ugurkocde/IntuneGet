import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Terms of Use | IntuneGet",
  description:
    "Terms of Use for IntuneGet - the Winget to Intune deployment tool.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-bg-deepest">
      {/* Header */}
      <header className="sticky top-0 z-40 w-full border-b border-white/5 bg-bg-deepest/80 backdrop-blur-xl">
        <div className="flex h-14 items-center px-4 lg:px-6 max-w-4xl mx-auto">
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/favicon.svg"
              alt="IntuneGet"
              width={24}
              height={24}
              className="h-6 w-6"
            />
            <span className="font-semibold text-white">IntuneGet</span>
          </Link>

          <div className="ml-auto">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>Back to Home</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-4xl px-4 py-12 lg:px-8 lg:py-16">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-white sm:text-4xl">
              Terms of Use
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Effective: January 24, 2026
            </p>
          </div>

          <p className="text-zinc-400 leading-relaxed">
            These Terms of Use (&quot;Terms&quot;) govern your access to and use
            of IntuneGet (the &quot;Service&quot;). By using the Service, you
            agree to these Terms.
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">
              Access and Eligibility
            </h2>
            <ul className="list-disc list-inside space-y-2 text-zinc-400">
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
            <h2 className="text-xl font-semibold text-white">
              Use of the Service
            </h2>
            <ul className="list-disc list-inside space-y-2 text-zinc-400">
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
            <h2 className="text-xl font-semibold text-white">Privacy</h2>
            <p className="text-zinc-400 leading-relaxed">
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
            <h2 className="text-xl font-semibold text-white">Disclaimer</h2>
            <p className="text-zinc-400 leading-relaxed">
              The Service is provided on an &quot;as is&quot; and &quot;as
              available&quot; basis without warranties of any kind. We do not
              warrant that the Service is error-free, complete, or suitable for
              any particular purpose. Validate outputs and deployments against
              your tenant as needed.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">
              Limitation of Liability
            </h2>
            <p className="text-zinc-400 leading-relaxed">
              To the maximum extent permitted by law, we shall not be liable for
              any indirect, incidental, special, consequential, or punitive
              damages, or any loss of data, profits, or revenues resulting from
              your use of the Service.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Changes</h2>
            <p className="text-zinc-400 leading-relaxed">
              We may modify these Terms to reflect improvements or changes to
              the Service. Continued use constitutes acceptance of the updated
              Terms.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-white">Contact</h2>
            <p className="text-zinc-400 leading-relaxed">
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
    </div>
  );
}
