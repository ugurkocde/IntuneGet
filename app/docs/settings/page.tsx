import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
import {
  ArrowRight,
  Settings,
  User,
  Shield,
  Bell,
  FileDown,
  Database,
  Webhook,
} from "lucide-react";
import {
  Callout,
  CodeBlock,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Collapsible,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "Settings & Webhooks | IntuneGet Docs",
  description:
    "Configure IntuneGet settings including notifications, webhooks, export preferences, permissions, and data management.",
  alternates: {
    canonical: "https://intuneget.com/docs/settings",
  },
  openGraph: {
    title: "Settings & Webhooks | IntuneGet Docs",
    description:
      "Configure IntuneGet settings including notifications, webhooks, export preferences, permissions, and data management.",
  },
};

export default function SettingsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Settings & Webhooks</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Configure your IntuneGet instance with account settings, permission
          management, notification preferences, export options, and data
          management.</T>
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Overview</T></h2>
        <p className="text-text-secondary mb-6">
          <T>The Settings page is organized into five tabs, each covering a
          different aspect of your IntuneGet configuration:</T>
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <User className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1"><T>General</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Account information and Intune connection status</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Shield className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Permissions</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Verify and manage Microsoft Graph API permissions</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Bell className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Notifications</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Email notifications and webhook configuration</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <FileDown className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Export</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Default format, icons, and metadata preferences</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Database className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Data</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Cache management, sync settings, and auto-refresh</T>
            </p>
          </div>
        </div>
      </section>

      {/* General Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>General Tab</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Displays your account information (name, email, authentication
          provider) and Intune connection details:</T>
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <T><strong>Account</strong> - Your Microsoft Entra ID profile
            information</T>
          </li>
          <li>
            <T><strong>Connection Status</strong> - Live indicator showing
            whether IntuneGet can reach your Intune tenant</T>
          </li>
          <li>
            <T><strong>Tenant ID</strong> - Your Microsoft 365 tenant identifier
            (with copy button)</T>
          </li>
          <li>
            <T><strong>Intune Portal</strong> - Quick link to the Microsoft Intune
            admin center</T>
          </li>
        </ul>
      </section>

      {/* Permissions Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Permissions Tab</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Verify which Microsoft Graph API permissions are granted to your
          IntuneGet app registration. Click &quot;Check Permissions&quot; to
          test each permission in real-time.</T>
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Permission</T></TableHeader>
              <TableHeader><T>Purpose</T></TableHeader>
              <TableHeader><T>Required</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  DeviceManagementApps.ReadWrite.All
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Read and write Intune applications (deploy packages)</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Yes</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  DeviceManagementManagedDevices.Read.All
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Read discovered apps from managed devices (Unmanaged Apps
                feature)</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>For Unmanaged Apps</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">User.Read</code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Read your profile information</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Yes</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  GroupMember.Read.All
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Read group information for app assignment</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>For group targeting</T>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Callout type="warning" title="Missing Permissions">
          <p>
            <T>If a required permission is missing, a Global Administrator must
            re-grant admin consent. The Settings page provides a direct
            &quot;Re-grant Admin Consent&quot; button when missing permissions
            are detected.</T>
          </p>
        </Callout>
      </section>

      {/* Notifications Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Notifications Tab</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Configure how and when you receive notifications about deployment
          events.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Email Notifications</T>
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Set your preferred email notification frequency:</T>
        </p>
        <ul className="list-disc list-inside space-y-1 text-text-secondary mb-6">
          <li>
            <T><strong>Real-time</strong> - Receive an email for every deployment
            event</T>
          </li>
          <li>
            <T><strong>Daily digest</strong> - A summary email sent once per day</T>
          </li>
          <li>
            <T><strong>Critical only</strong> - Only receive emails for failures
            and errors</T>
          </li>
          <li>
            <T><strong>Disabled</strong> - No email notifications</T>
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Webhook Configuration</T>
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Set up webhooks to receive deployment notifications in your preferred
          tools. IntuneGet supports pre-configured templates for popular
          platforms:</T>
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Platform</T></TableHeader>
              <TableHeader><T>Description</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Slack</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Send notifications to a Slack channel via incoming webhook</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                <T>Microsoft Teams</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Post deployment updates to a Teams channel</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Discord</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Send messages to a Discord channel via webhook</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Custom</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Any HTTP endpoint that accepts POST requests with JSON payloads</T>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
          <T>Structured Payload Data</T>
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Every webhook payload includes a machine-readable <code>data</code>{" "}
          object alongside the platform-specific message (Slack blocks, Teams
          Adaptive Card, Discord embeds, or the raw custom payload). Use it to
          process notifications programmatically without parsing the
          presentation format:</T>
        </p>
        <CodeBlock language="json">
{`{
  "data": {
    "event": "app_updates_available",
    "timestamp": "2026-06-25T12:40:07Z",
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "tenant_name": "Contoso",
    "summary": { "total": 1, "critical": 0 },
    "updates": [
      {
        "displayName": "Notepad++",
        "wingetId": "Notepad++.Notepad++",
        "intuneAppId": "11111111-1111-1111-1111-111111111111",
        "fromVersion": "8.9.4",
        "toVersion": "8.9.6",
        "isCritical": false
      }
    ]
  }
}`}
        </CodeBlock>

        <Callout type="info" title="Webhook Security">
          <p>
            <T>Each webhook is signed with an HMAC secret that you configure during
            setup. Use this to verify that incoming requests genuinely originate
            from your IntuneGet instance.</T>
          </p>
        </Callout>
      </section>

      {/* Export Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Export Tab</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Configure default export preferences used when downloading deployment
          data and reports:</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Export Formats</T>
        </h3>
        <ul className="list-disc list-inside space-y-2 text-text-secondary mb-6">
          <li>
            <T><strong>CSV</strong> - Comma-separated values, compatible with Excel
            and Google Sheets</T>
          </li>
          <li>
            <T><strong>JSON</strong> - Structured format ideal for programmatic
            processing</T>
          </li>
          <li>
            <T><strong>XLSX</strong> - Native Excel format with formatting and
            multiple sheets</T>
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Additional Options</T>
        </h3>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <T><strong>Include Application Icons</strong> - Embed base64-encoded
            icons in export files</T>
          </li>
          <li>
            <T><strong>Include Metadata</strong> - Add deployment dates, version
            history, and assignment information</T>
          </li>
        </ul>
      </section>

      {/* Data Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Data Tab</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Manage cached data, synchronization, and auto-refresh settings:</T>
        </p>

        <div className="space-y-4">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h4 className="font-medium text-text-primary mb-1"><T>Application Cache</T></h4>
            <p className="text-sm text-text-secondary">
              <T>Cached application data speeds up loading times. Click
              &quot;Clear Cache&quot; to force fresh data on next load.</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h4 className="font-medium text-text-primary mb-1"><T>Force Sync</T></h4>
            <p className="text-sm text-text-secondary">
              <T>Re-fetch all application data from Intune immediately. Useful
              after making changes directly in the Intune portal.</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h4 className="font-medium text-text-primary mb-1">
              <T>Auto-Refresh Interval</T>
            </h4>
            <p className="text-sm text-text-secondary">
              <T>Configure how often IntuneGet checks for new application data.
              Options: 5 minutes, 15 minutes (default), 30 minutes, or 1 hour.</T>
            </p>
          </div>
        </div>

        <Callout type="info" title="Local Storage">
          <p>
            <T>All cached application data is stored locally in your browser. No
            data is sent to third-party servers. Clearing your browser cache
            will also clear IntuneGet&apos;s cached data.</T>
          </p>
        </Callout>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3"><T>Next Steps</T></h2>
        <p className="text-text-secondary mb-4">
          <T>Review the troubleshooting guide for common configuration issues, or
          learn about the Unmanaged Apps feature.</T>
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            <T>Troubleshooting</T>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/unmanaged-apps"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            <T>Unmanaged Apps</T>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
