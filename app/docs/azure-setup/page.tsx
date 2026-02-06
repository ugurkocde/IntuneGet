import { Metadata } from "next";
import Link from "next/link";
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
};

export default function AzureSetupPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Entra ID Setup
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Configure Microsoft Entra ID to enable user
          authentication and Intune API access for IntuneGet.
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Overview</h2>
        <p className="text-text-secondary mb-4">
          IntuneGet uses a multi-tenant app registration that allows users from any
          Microsoft 365 organization to:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>Sign in with their work account</li>
          <li>Grant admin consent for app deployment permissions</li>
          <li>Deploy applications to their Intune tenant</li>
        </ul>
      </section>

      {/* Create App Registration */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          Create App Registration
        </h2>

        <Steps>
          <StepIndicator step={1} title="Navigate to App Registrations">
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                Go to{" "}
                <a
                  href="https://portal.azure.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline inline-flex items-center gap-1"
                >
                  Azure Portal
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
              <li>
                Navigate to <strong>Microsoft Entra ID</strong> (you can search for
                it)
              </li>
              <li>
                Click <strong>App registrations</strong> in the left menu
              </li>
              <li>
                Click <strong>New registration</strong>
              </li>
            </ol>
          </StepIndicator>

          <StepIndicator step={2} title="Configure Registration Settings">
            <p className="mb-4">Fill in the registration form:</p>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Setting</TableHeader>
                  <TableHeader>Value</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">Name</TableCell>
                  <TableCell>
                    <code className="text-accent-cyan">IntuneGet</code> (or your
                    preferred name)
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">
                    Supported account types
                  </TableCell>
                  <TableCell>
                    <strong>
                      Accounts in any organizational directory (Any Microsoft Entra
                      ID tenant - Multitenant)
                    </strong>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">
                    Redirect URI (type)
                  </TableCell>
                  <TableCell>
                    <strong>Single-page application (SPA)</strong>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-text-primary">
                    Redirect URI (value)
                  </TableCell>
                  <TableCell>
                    <code className="text-accent-cyan">http://localhost:3000</code>{" "}
                    (for development)
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="mt-4 text-text-secondary">
              Click <strong>Register</strong> to create the app.
            </p>
          </StepIndicator>

          <StepIndicator step={3} title="Add Production Redirect URI">
            <p className="mb-4">
              After registration, add your production URL:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                Go to <strong>Authentication</strong> in the left menu
              </li>
              <li>
                Under <strong>Single-page application</strong>, click{" "}
                <strong>Add URI</strong>
              </li>
              <li>
                Add your production URL (e.g.,{" "}
                <code className="text-accent-cyan">
                  https://your-app.vercel.app
                </code>
                )
              </li>
              <li>
                Click <strong>Save</strong>
              </li>
            </ol>
            <Callout type="warning" title="Exact URL Match Required">
              <p>
                The redirect URI must match exactly - including the protocol
                (https://) and without a trailing slash.
              </p>
            </Callout>
          </StepIndicator>

          <StepIndicator step={4} title="Configure API Permissions">
            <p className="mb-4">
              IntuneGet requires two types of permissions:
            </p>

            <h4 className="font-semibold text-text-primary mt-6 mb-3">
              Delegated Permissions (User Sign-in)
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                Go to <strong>API permissions</strong> in the left menu
              </li>
              <li>
                Click <strong>Add a permission</strong>
              </li>
              <li>
                Select <strong>Microsoft Graph</strong>
              </li>
              <li>
                Select <strong>Delegated permissions</strong>
              </li>
              <li>
                Search and add: <code className="text-accent-cyan">User.Read</code>
              </li>
              <li>
                Click <strong>Add permissions</strong>
              </li>
            </ol>

            <h4 className="font-semibold text-text-primary mt-6 mb-3">
              Application Permissions (Service Principal)
            </h4>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                Click <strong>Add a permission</strong> again
              </li>
              <li>
                Select <strong>Microsoft Graph</strong>
              </li>
              <li>
                Select <strong>Application permissions</strong>
              </li>
              <li>
                Search and add:{" "}
                <code className="text-accent-cyan">
                  DeviceManagementApps.ReadWrite.All
                </code>
              </li>
              <li>
                Search and add:{" "}
                <code className="text-accent-cyan">
                  DeviceManagementManagedDevices.Read.All
                </code>
              </li>
              <li>
                Click <strong>Add permissions</strong>
              </li>
            </ol>

            <div className="mt-6">
              <p className="text-sm text-text-secondary mb-3">
                Your permissions should look like this:
              </p>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableHeader>Permission</TableHeader>
                    <TableHeader>Type</TableHeader>
                    <TableHeader>Status</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>User.Read</TableCell>
                    <TableCell>Delegated</TableCell>
                    <TableCell className="text-status-success">
                      Granted for your org
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>DeviceManagementApps.ReadWrite.All</TableCell>
                    <TableCell>Application</TableCell>
                    <TableCell className="text-status-warning">
                      Requires admin consent
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>DeviceManagementManagedDevices.Read.All</TableCell>
                    <TableCell>Application</TableCell>
                    <TableCell className="text-status-warning">
                      Requires admin consent
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </StepIndicator>

          <StepIndicator step={5} title="Create Client Secret" isLast>
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                Go to <strong>Certificates & secrets</strong> in the left menu
              </li>
              <li>
                Click <strong>New client secret</strong>
              </li>
              <li>
                Add a description: <code>IntuneGet Production</code>
              </li>
              <li>Select expiration (recommend: 24 months)</li>
              <li>
                Click <strong>Add</strong>
              </li>
              <li>
                <strong>Immediately copy the secret value</strong> - it won&apos;t
                be shown again!
              </li>
            </ol>
            <Callout type="error" title="Copy the Secret Now!">
              <p>
                The client secret value is only shown once. If you navigate away
                without copying it, you&apos;ll need to create a new one.
              </p>
            </Callout>
          </StepIndicator>
        </Steps>
      </section>

      {/* Collect Values */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Collect Required Values
        </h2>
        <p className="text-text-secondary mb-6">
          After setup, collect these values for your environment configuration:
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Value</TableHeader>
              <TableHeader>Location</TableHeader>
              <TableHeader>Environment Variable</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                Application (client) ID
              </TableCell>
              <TableCell>Overview page</TableCell>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  NEXT_PUBLIC_AZURE_AD_CLIENT_ID
                </code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Client secret</TableCell>
              <TableCell>Certificates & secrets</TableCell>
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
          Admin Consent Flow
        </h2>
        <p className="text-text-secondary mb-4">
          When users from other organizations use IntuneGet, a Global Administrator
          from their tenant must grant consent for the application permissions.
        </p>

        <div className="rounded-lg border border-black/10 bg-white p-6 mb-6">
          <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Shield className="h-5 w-5 text-accent-cyan" />
            How Admin Consent Works
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-text-secondary">
            <li>User signs in to IntuneGet</li>
            <li>IntuneGet checks if admin consent was granted</li>
            <li>If not, user sees instructions to request consent</li>
            <li>Global Admin visits the consent URL</li>
            <li>Admin reviews and grants permissions</li>
            <li>User can now deploy apps</li>
          </ol>
        </div>

        <h3 className="font-semibold text-text-primary mb-3">Admin Consent URL Format</h3>
        <CodeBlock language="text">
{`https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}&redirect_uri={redirect-uri}`}
        </CodeBlock>

        <p className="text-text-secondary mt-4 mb-2">Example:</p>
        <CodeBlock language="text">
{`https://login.microsoftonline.com/contoso.onmicrosoft.com/adminconsent?client_id=12345678-1234-1234-1234-123456789abc&redirect_uri=https://your-app.vercel.app`}
        </CodeBlock>
      </section>

      {/* Security Recommendations */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Security Recommendations
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
              className="rounded-lg border border-black/10 bg-white p-4"
            >
              <h3 className="font-medium text-text-primary mb-2">{item.title}</h3>
              <p className="text-sm text-text-secondary">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Troubleshooting */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Common Issues
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS50011: Reply URL does not match
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              Your redirect URI doesn&apos;t match what&apos;s configured:
            </p>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>Check the exact URL (including trailing slashes)</li>
              <li>
                Verify it&apos;s added as a <strong>SPA</strong> redirect, not Web
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS65001: User or admin has not consented
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              Admin consent hasn&apos;t been granted:
            </p>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>Direct the admin to the consent URL</li>
              <li>Ensure they&apos;re using a Global Administrator account</li>
              <li>Verify they click &quot;Accept&quot; on the consent screen</li>
            </ul>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Invalid client secret
            </h3>
            <p className="text-sm text-text-secondary mb-2">
              The client secret is wrong or expired:
            </p>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>Check AZURE_CLIENT_SECRET matches the secret in Azure</li>
              <li>Verify the secret hasn&apos;t expired</li>
              <li>Create a new secret if needed</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Next Steps</h2>
        <p className="text-text-secondary mb-4">
          Now that Entra ID is configured, continue with the database setup.
        </p>
        <Link
          href="/docs/database-setup"
          className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
        >
          Continue to Database Setup
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
