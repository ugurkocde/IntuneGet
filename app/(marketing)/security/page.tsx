import { Metadata } from "next";
import { ReactNode } from "react";
import Link from "next/link";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/sections/Footer";
import { T } from "gt-next";

export const metadata: Metadata = {
  title: "Security & Permissions | IntuneGet",
  description:
    "Exactly which Microsoft Graph permissions IntuneGet requests, how admin consent works, where data lives, and why installers and credentials never touch our infrastructure.",
  alternates: {
    canonical: "https://intuneget.com/security",
  },
  openGraph: {
    title: "Security & Permissions | IntuneGet",
    description:
      "Exactly which Microsoft Graph permissions IntuneGet requests, how admin consent works, where data lives, and why installers and credentials never touch our infrastructure.",
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
      name: "Security & Permissions",
      item: "https://intuneget.com/security",
    },
  ],
};

const permissions: {
  scope: string;
  type: "Delegated" | "Application";
  readOnly: boolean;
  purpose: ReactNode;
}[] = [
  {
    scope: "User.Read",
    type: "Delegated",
    readOnly: true,
    purpose: <T>Sign you in and read your basic profile</T>,
  },
  {
    scope: "DeviceManagementApps.ReadWrite.All",
    type: "Application",
    readOnly: false,
    purpose: (
      <T>
        Create and update the Win32 apps IntuneGet uploads to your Intune
        tenant
      </T>
    ),
  },
  {
    scope: "DeviceManagementConfiguration.Read.All",
    type: "Application",
    readOnly: true,
    purpose: <T>Read device configuration for deployment context</T>,
  },
  {
    scope: "DeviceManagementManagedDevices.Read.All",
    type: "Application",
    readOnly: true,
    purpose: <T>Read managed device information for reporting</T>,
  },
  {
    scope: "DeviceManagementServiceConfig.ReadWrite.All",
    type: "Application",
    readOnly: false,
    purpose: (
      <T>
        Read and update Intune service configuration used during app setup
        (e.g. enrollment status page references)
      </T>
    ),
  },
  {
    scope: "GroupMember.Read.All",
    type: "Application",
    readOnly: true,
    purpose: (
      <T>Read group membership so you can pick assignment groups</T>
    ),
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-bg-deepest flex flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Content */}
      <main id="main-content" className="flex-1 mx-auto max-w-4xl px-4 py-12 lg:px-8 lg:py-16 pt-24 lg:pt-28">
        <div className="space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
              <T>Security &amp; Permissions</T>
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              <T>Last updated: July 10, 2026</T>
            </p>
          </div>

          <p className="text-text-secondary leading-relaxed">
            <T>
              IntuneGet asks for access to your Intune tenant, and you deserve
              to know exactly what that means before you grant it. This page
              lists every Microsoft Graph permission the app requests, what
              each one is used for, how consent works, and where your data
              does - and does not - go.
            </T>
          </p>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>How Access Works</T>
            </h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                IntuneGet uses two kinds of Microsoft Entra ID access, and it
                is important to keep them apart:
              </T>
            </p>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <strong className="text-text-primary">
                  <T>Delegated sign-in scopes.</T>
                </strong>{" "}
                <T>
                  When you sign in, the app requests only sign-in and basic
                  profile scopes
                </T>{" "}
                (<code className="text-text-primary">User.Read</code>,{" "}
                <code className="text-text-primary">openid</code>,{" "}
                <code className="text-text-primary">profile</code>).{" "}
                <T>
                  These identify who you are; they do not grant any access to
                  Intune.
                </T>
              </li>
              <li>
                <strong className="text-text-primary">
                  <T>Application permissions.</T>
                </strong>{" "}
                <T>
                  The Intune operations run under application permissions that
                  an administrator grants once per tenant via admin consent.
                  They are scoped to the specific Graph APIs listed below and
                  can be revoked from your tenant at any time.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Permissions Requested</T>
            </h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                This is the complete list of Microsoft Graph permissions on the
                IntuneGet app registration. Nothing else is requested.
              </T>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border-primary">
                    <th
                      scope="col"
                      className="py-3 pr-4 font-semibold text-text-primary"
                    >
                      <T>Permission</T>
                    </th>
                    <th
                      scope="col"
                      className="py-3 pr-4 font-semibold text-text-primary"
                    >
                      <T>Type</T>
                    </th>
                    <th
                      scope="col"
                      className="py-3 pr-4 font-semibold text-text-primary"
                    >
                      <T>Access</T>
                    </th>
                    <th
                      scope="col"
                      className="py-3 font-semibold text-text-primary"
                    >
                      <T>What it is used for</T>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {permissions.map((permission) => (
                    <tr
                      key={permission.scope}
                      className="border-b border-border-primary/50 align-top"
                    >
                      <th
                        scope="row"
                        className="py-3 pr-4 font-normal text-text-primary"
                      >
                        <code className="break-all">{permission.scope}</code>
                      </th>
                      <td className="py-3 pr-4 text-text-secondary whitespace-nowrap">
                        {permission.type === "Delegated" ? (
                          <T>Delegated</T>
                        ) : (
                          <T>Application</T>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-text-secondary whitespace-nowrap">
                        {permission.readOnly ? (
                          <T>Read-only</T>
                        ) : (
                          <T>Read and write</T>
                        )}
                      </td>
                      <td className="py-3 text-text-secondary">
                        {permission.purpose}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Consent and Roles</T>
            </h2>
            <p className="text-text-secondary leading-relaxed">
              <T>Setting up IntuneGet is a two-step model:</T>
            </p>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <strong className="text-text-primary">
                  <T>Step 1: one-time admin consent.</T>
                </strong>{" "}
                <T>
                  A Global Administrator grants tenant-wide admin consent to
                  the application permissions listed above. This happens once
                  per tenant.
                </T>
              </li>
              <li>
                <strong className="text-text-primary">
                  <T>Step 2: day-to-day use.</T>
                </strong>{" "}
                <T>
                  After consent, team members sign in with their normal
                  Microsoft work account. We recommend an Intune Administrator
                  or an equivalently permissioned account for managing
                  deployments, but a Global Administrator is not needed for
                  everyday work.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>How Your Data Flows</T>
            </h2>
            {/* TODO: add a data-flow diagram figure here (browser -> GitHub-hosted runner -> your Intune tenant) once the illustration is ready. */}
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  Access tokens stay in your browser session; we do not persist
                  them server-side.
                </T>
              </li>
              <li>
                <T>
                  Packaging runs on temporary, ephemeral GitHub-hosted runners
                  that are destroyed after each job.
                </T>
              </li>
              <li>
                <T>
                  Packaged apps are uploaded directly to your own Intune
                  tenant.
                </T>
              </li>
              <li>
                <T>
                  Application installers are never stored by IntuneGet - not on
                  our servers, and not in our database.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Data Residency</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  On the hosted version (intuneget.com), data is stored in the
                  European Union, in Supabase&apos;s Frankfurt, Germany region
                  (eu-central-1).
                </T>
              </li>
              <li>
                <T>
                  We only keep the operational metadata needed to run the
                  service, such as your account email, deployment history, app
                  catalog, and team settings.
                </T>
              </li>
              <li>
                <T>
                  We never store your app installers or your Intune
                  credentials: authentication uses Microsoft Entra ID, and
                  access tokens stay in your browser.
                </T>
              </li>
              <li>
                <T>
                  The web app is served over an encrypted (TLS) connection via
                  Vercel&apos;s global edge network.
                </T>
              </li>
              <li>
                <T>
                  If you need data to stay entirely on your own infrastructure
                  or in a specific region, IntuneGet can be self-hosted with an
                  embedded SQLite database.
                </T>
              </li>
            </ul>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Open Source and No Lock-In</T>
            </h2>
            <p className="text-text-secondary leading-relaxed">
              <T>
                IntuneGet is open source under the AGPL-3.0 license. The full
                source code is available on{" "}
                <a
                  href="https://github.com/ugurkocde/IntuneGet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                >
                  GitHub
                </a>
                , so you can audit exactly what the app does with the
                permissions it holds. If you ever want to leave the hosted
                version, self-hosting with Docker and an embedded SQLite
                database is the built-in escape hatch - your deployments live
                in your own Intune tenant either way.
              </T>
            </p>
            <p className="text-text-secondary leading-relaxed">
              <T>
                To be transparent: IntuneGet is not SOC 2 certified. Instead,
                the architecture is designed so that the most sensitive assets
                never reach IntuneGet infrastructure in the first place - your
                Intune credentials stay with Microsoft, access tokens stay in
                your browser, and installers flow from ephemeral runners
                straight into your tenant.
              </T>
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold text-text-primary">
              <T>Related Resources</T>
            </h2>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <T>
                  Read our{" "}
                  <Link
                    href="/privacy"
                    className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                  >
                    Privacy Policy
                  </Link>{" "}
                  for details on data handling and analytics.
                </T>
              </li>
              <li>
                <T>
                  See the{" "}
                  <Link
                    href="/docs"
                    className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                  >
                    documentation
                  </Link>{" "}
                  for setup guides, including Azure and self-hosting.
                </T>
              </li>
              <li>
                <T>
                  Report security issues via a{" "}
                  <a
                    href="https://github.com/ugurkocde/IntuneGet/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                  >
                    GitHub issue
                  </a>{" "}
                  for non-sensitive reports, or email{" "}
                  <a
                    href="mailto:security@intuneget.com"
                    className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                  >
                    security@intuneget.com
                  </a>{" "}
                  for sensitive ones, as described in our{" "}
                  <a
                    href="https://github.com/ugurkocde/IntuneGet/blob/main/SECURITY.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-cyan hover:text-accent-cyan-bright transition-colors"
                  >
                    security policy
                  </a>
                  .
                </T>
              </li>
            </ul>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
