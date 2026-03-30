import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
import { ArrowRight, ExternalLink, Shield, AlertCircle } from "lucide-react";
import {
  Callout,
  CodeBlock,
  Steps,
  StepIndicator,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "Entra ID Setup | IntuneGet Docs",
  description:
    "Configure Microsoft Entra ID app registration for IntuneGet authentication and Intune API access.",
  alternates: {
    canonical: "https://intuneget.com/docs/azure-setup",
  },
  openGraph: {
    title: "Entra ID Setup | IntuneGet Docs",
    description:
      "Configure Microsoft Entra ID app registration for IntuneGet authentication and Intune API access.",
  },
};

export default function AzureSetupPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Entra ID Setup</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Configure Microsoft Entra ID to enable user
          authentication and Intune API access for IntuneGet.</T>
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Overview</T></h2>
        <p className="text-text-secondary mb-4">
          <T>IntuneGet uses a multi-tenant app registration that allows users from any
          Microsoft 365 organization to:</T>
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li><T>Sign in with their work account</T></li>
          <li><T>Grant admin consent for app deployment permissions</T></li>
          <li><T>Deploy applications to their Intune tenant</T></li>
        </ul>
      </section>

      {/* Create App Registration */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          <T>Create App Registration</T>
        </h2>

        <Steps>
          <StepIndicator step={1} title="Navigate to App Registrations">
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                <T>Go to{" "}
                <a
                  href="https://portal.azure.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline inline-flex items-center gap-1"
                >
                  Azure Portal
                  <ExternalLink className="h-3.5 w-3.5" />
                </a></T>
              </li>
              <li>
                <T>Navigate to <strong>Microsoft Entra ID</strong> (you can search for
                it)</T>
              </li>
              <li>
                <T>Click <strong>App registrations</strong> in the left menu</T>
              </li>
              <li>
                <T>Click <strong>New registration</strong></T>
              </li>
            </ol>
          </StepIndicator>

          <StepIndicator step={2} title="Configure Registration Settings">
            <p className="mb-4"><T>Fill in the registration form:</T></p>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader><T>Setting</T></TableHeader>
                  <TableHeader><T>Value</T></TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-text-primary"><T>Name</T></TableCell>
                  <TableCell>
                    <T><code className="text-accent-cyan">IntuneGet</code> (or your
                    preferred name)</T>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">
                    <T>Supported account types</T>
                  </TableCell>
                  <TableCell>
                    <strong>
                      <T>Accounts in any organizational directory (Any Microsoft Entra
                      ID tenant - Multitenant)</T>
                    </strong>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">
                    <T>Redirect URI (type)</T>
                  </TableCell>
                  <TableCell>
                    <strong><T>Single-page application (SPA)</T></strong>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">
                    <T>Redirect URI (value)</T>
                  </TableCell>
                  <TableCell>
                    <T><code className="text-accent-cyan">http://localhost:3000</code>{" "}
                    (for development)</T>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="mt-4 text-text-secondary">
              <T>Click <strong>Register</strong> to create the app.</T>
            </p>
          </StepIndicator>

          <StepIndicator step={3} title="Add Production Redirect URI">
            <p className="mb-4">
              <T>After registration, add your production URL:</T>
            </p>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                <T>Go to <strong>Authentication</strong> in the left menu</T>
              </li>
              <li>
                <T>Under <strong>Single-page application</strong>, click{" "}
                <strong>Add URI</strong></T>
              </li>
              <li>
                <T>Add your production URL (e.g.,{" "}
                <code className="text-accent-cyan">
                  https://your-app.vercel.app
                </code>
                )</T>
              </li>
              <li>
                <T>Click <strong>Save</strong></T>
              </li>
            </ol>
            <Callout type="warning" title="Exact URL Match Required">
              <p>
                <T>The redirect URI must match exactly - including the protocol
                (https://) and without a trailing slash.</T>
              </p>
            </Callout>
          </StepIndicator>

          <StepIndicator step={4} title="Configure API Permissions">
            <p className="mb-4">
              <T>IntuneGet requires two types of permissions:</T>
            </p>

            <h4 className="font-semibold text-text-primary mt-6 mb-3">
              <T>Delegated Permissions (User Sign-in)</T>
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                <T>Go to <strong>API permissions</strong> in the left menu</T>
              </li>
              <li>
                <T>Click <strong>Add a permission</strong></T>
              </li>
              <li>
                <T>Select <strong>Microsoft Graph</strong></T>
              </li>
              <li>
                <T>Select <strong>Delegated permissions</strong></T>
              </li>
              <li>
                <T>Search and add: <code className="text-accent-cyan">User.Read</code></T>
              </li>
              <li>
                <T>Click <strong>Add permissions</strong></T>
              </li>
            </ol>

            <h4 className="font-semibold text-text-primary mt-6 mb-3">
              <T>Application Permissions (Service Principal)</T>
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                <T>Click <strong>Add a permission</strong> again</T>
              </li>
              <li>
                <T>Select <strong>Microsoft Graph</strong></T>
              </li>
              <li>
                <T>Select <strong>Application permissions</strong></T>
              </li>
              <li>
                <T>Search and add:{" "}
                <code className="text-accent-cyan">
                  DeviceManagementApps.ReadWrite.All
                </code></T>
              </li>
              <li>
                <T>Search and add:{" "}
                <code className="text-accent-cyan">
                  DeviceManagementManagedDevices.Read.All
                </code></T>
              </li>
              <li>
                <T>Search and add:{" "}
                <code className="text-accent-cyan">
                  DeviceManagementServiceConfig.ReadWrite.All
                </code></T>
              </li>
              <li>
                <T>Click <strong>Add permissions</strong></T>
              </li>
            </ol>

            <div className="mt-6">
              <p className="text-sm text-text-secondary mb-3">
                <T>Your permissions should look like this:</T>
              </p>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader><T>Permission</T></TableHeader>
                    <TableHeader><T>Type</T></TableHeader>
                    <TableHeader><T>Status</T></TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>User.Read</TableCell>
                    <TableCell><T>Delegated</T></TableCell>
                    <TableCell className="text-status-success">
                      <T>Granted for your org</T>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>DeviceManagementApps.ReadWrite.All</TableCell>
                    <TableCell><T>Application</T></TableCell>
                    <TableCell className="text-status-warning">
                      <T>Requires admin consent</T>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>DeviceManagementManagedDevices.Read.All</TableCell>
                    <TableCell><T>Application</T></TableCell>
                    <TableCell className="text-status-warning">
                      <T>Requires admin consent</T>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>DeviceManagementServiceConfig.ReadWrite.All</TableCell>
                    <TableCell><T>Application</T></TableCell>
                    <TableCell className="text-status-warning">
                      <T>Requires admin consent</T>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </StepIndicator>

          <StepIndicator step={5} title="Create Client Secret" isLast>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                <T>Go to <strong>Certificates & secrets</strong> in the left menu</T>
              </li>
              <li>
                <T>Click <strong>New client secret</strong></T>
              </li>
              <li>
                <T>Add a description: <code>IntuneGet Production</code></T>
              </li>
              <li><T>Select expiration (recommend: 24 months)</T></li>
              <li>
                <T>Click <strong>Add</strong></T>
              </li>
              <li>
                <T><strong>Immediately copy the secret value</strong> - it won&apos;t
                be shown again!</T>
              </li>
            </ol>
            <Callout type="error" title="Copy the Secret Now!">
              <p>
                <T>The client secret value is only shown once. If you navigate away
                without copying it, you&apos;ll need to create a new one.</T>
              </p>
            </Callout>
          </StepIndicator>
        </Steps>
      </section>

      {/* Collect Values */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Collect Required Values</T>
        </h2>
        <p className="text-text-secondary mb-6">
          <T>After setup, collect these values for your environment configuration:</T>
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Value</T></TableHeader>
              <TableHeader><T>Location</T></TableHeader>
              <TableHeader><T>Environment Variable</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                <T>Application (client) ID</T>
              </TableCell>
              <TableCell><T>Overview page</T></TableCell>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  NEXT_PUBLIC_AZURE_AD_CLIENT_ID
                </code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Client secret</T></TableCell>
              <TableCell><T>Certificates & secrets</T></TableCell>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  AZURE_CLIENT_SECRET
                </code>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Admin Consent */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Admin Consent Flow</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>When users from other organizations use IntuneGet, a Global Administrator
          from their tenant must grant consent for the application permissions.</T>
        </p>

        <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-6 mb-6">
          <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-accent-cyan" />
            <T>How Admin Consent Works</T>
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-text-secondary">
            <li><T>User signs in to IntuneGet</T></li>
            <li><T>IntuneGet checks if admin consent was granted</T></li>
            <li><T>If not, user sees instructions to request consent</T></li>
            <li><T>Global Admin visits the consent URL</T></li>
            <li><T>Admin reviews and grants permissions</T></li>
            <li><T>User can now deploy apps</T></li>
          </ol>
        </div>

        <h3 className="font-semibold text-text-primary mb-3"><T>Admin Consent URL Format</T></h3>
        <CodeBlock language="text">
{`https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}&redirect_uri={redirect-uri}`}
        </CodeBlock>

        <p className="text-text-secondary mt-4 mb-2"><T>Example:</T></p>
        <CodeBlock language="text">
{`https://login.microsoftonline.com/contoso.onmicrosoft.com/adminconsent?client_id=12345678-1234-1234-1234-123456789abc&redirect_uri=https://your-app.vercel.app`}
        </CodeBlock>
      </section>

      {/* Security Recommendations */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Security Recommendations</T>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            {
              title: "Rotate secrets regularly",
              description:
                "Set calendar reminders before expiration. Rotate every 12-24 months.",
            },
            {
              title: "Use separate registrations",
              description:
                "Create separate apps for dev/staging/production environments.",
            },
            {
              title: "Monitor sign-ins",
              description:
                "Review sign-in logs in Entra ID periodically for suspicious activity.",
            },
            {
              title: "Limit admin consent",
              description:
                "Educate admins about what permissions they're granting.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-lg border border-overlay/10 bg-bg-elevated p-4"
            >
              <h3 className="font-medium text-text-primary mb-2"><T>{item.title}</T></h3>
              <p className="text-sm text-text-secondary"><T>{item.description}</T></p>
            </div>
          ))}
        </div>
      </section>

      {/* Troubleshooting */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Common Issues</T>
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS50011: Reply URL does not match
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              <T>Your redirect URI doesn&apos;t match what&apos;s configured:</T>
            </p>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li><T>Check the exact URL (including trailing slashes)</T></li>
              <li>
                <T>Verify it&apos;s added as a <strong>SPA</strong> redirect, not Web</T>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS65001: User or admin has not consented
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              <T>Admin consent hasn&apos;t been granted:</T>
            </p>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li><T>Direct the admin to the consent URL</T></li>
              <li><T>Ensure they&apos;re using a Global Administrator account</T></li>
              <li><T>Verify they click &quot;Accept&quot; on the consent screen</T></li>
            </ul>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Invalid client secret
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              <T>The client secret is wrong or expired:</T>
            </p>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li><T>Check AZURE_CLIENT_SECRET matches the secret in Azure</T></li>
              <li><T>Verify the secret hasn&apos;t expired</T></li>
              <li><T>Create a new secret if needed</T></li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3"><T>Next Steps</T></h2>
        <p className="text-text-secondary mb-4">
          <T>Now that Entra ID is configured, continue with the database setup.</T>
        </p>
        <Link
          href="/docs/database-setup"
          className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
        >
          <T>Continue to Database Setup</T>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
