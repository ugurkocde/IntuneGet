import { Metadata } from "next";
import Link from "next/link";
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
};

export default function SettingsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Settings & Webhooks
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Configure your IntuneGet instance with account settings, permission
          management, notification preferences, export options, and data
          management.
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Overview</h2>
        <p className="text-text-secondary mb-6">
          The Settings page is organized into five tabs, each covering a
          different aspect of your IntuneGet configuration:
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <User className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1">General</h3>
            <p className="text-sm text-text-secondary">
              Account information and Intune connection status
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Shield className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1">Permissions</h3>
            <p className="text-sm text-text-secondary">
              Verify and manage Microsoft Graph API permissions
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Bell className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1">Notifications</h3>
            <p className="text-sm text-text-secondary">
              Email notifications and webhook configuration
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <FileDown className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1">Export</h3>
            <p className="text-sm text-text-secondary">
              Default format, icons, and metadata preferences
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Database className="h-5 w-5 text-accent-cyan mb-2" />
            <h3 className="font-semibold text-text-primary mb-1">Data</h3>
            <p className="text-sm text-text-secondary">
              Cache management, sync settings, and auto-refresh
            </p>
          </div>
        </div>
      </section>

      {/* General Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          General Tab
        </h2>
        <p className="text-text-secondary mb-4">
          Displays your account information (name, email, authentication
          provider) and Intune connection details:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <strong>Account</strong> - Your Microsoft Entra ID profile
            information
          </li>
          <li>
            <strong>Connection Status</strong> - Live indicator showing
            whether IntuneGet can reach your Intune tenant
          </li>
          <li>
            <strong>Tenant ID</strong> - Your Microsoft 365 tenant identifier
            (with copy button)
          </li>
          <li>
            <strong>Intune Portal</strong> - Quick link to the Microsoft Intune
            admin center
          </li>
        </ul>
      </section>

      {/* Permissions Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Permissions Tab
        </h2>
        <p className="text-text-secondary mb-4">
          Verify which Microsoft Graph API permissions are granted to your
          IntuneGet app registration. Click &quot;Check Permissions&quot; to
          test each permission in real-time.
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Permission</TableHeader>
              <TableHeader>Purpose</TableHeader>
              <TableHeader>Required</TableHeader>
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
                Read and write Intune applications (deploy packages)
              </TableCell>
              <TableCell className="text-sm text-text-secondary">Yes</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  DeviceManagementManagedDevices.Read.All
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Read discovered apps from managed devices (Unmanaged Apps
                feature)
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                For Unmanaged Apps
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">User.Read</code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Read your profile information
              </TableCell>
              <TableCell className="text-sm text-text-secondary">Yes</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">
                  Group.Read.All
                </code>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Read group memberships for app assignment
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                For group targeting
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Callout type="warning" title="Missing Permissions">
          <p>
            If a required permission is missing, a Global Administrator must
            re-grant admin consent. The Settings page provides a direct
            &quot;Re-grant Admin Consent&quot; button when missing permissions
            are detected.
          </p>
        </Callout>
      </section>

      {/* Notifications Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Notifications Tab
        </h2>
        <p className="text-text-secondary mb-4">
          Configure how and when you receive notifications about deployment
          events.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Email Notifications
        </h3>
        <p className="text-text-secondary mb-4">
          Set your preferred email notification frequency:
        </p>
        <ul className="list-disc list-inside space-y-1 text-text-secondary mb-6">
          <li>
            <strong>Real-time</strong> - Receive an email for every deployment
            event
          </li>
          <li>
            <strong>Daily digest</strong> - A summary email sent once per day
          </li>
          <li>
            <strong>Critical only</strong> - Only receive emails for failures
            and errors
          </li>
          <li>
            <strong>Disabled</strong> - No email notifications
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Webhook Configuration
        </h3>
        <p className="text-text-secondary mb-4">
          Set up webhooks to receive deployment notifications in your preferred
          tools. IntuneGet supports pre-configured templates for popular
          platforms:
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Platform</TableHeader>
              <TableHeader>Description</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Slack</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Send notifications to a Slack channel via incoming webhook
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                Microsoft Teams
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Post deployment updates to a Teams channel
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Discord</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Send messages to a Discord channel via webhook
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Custom</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Any HTTP endpoint that accepts POST requests with JSON payloads
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Callout type="info" title="Webhook Security">
          <p>
            Each webhook is signed with an HMAC secret that you configure during
            setup. Use this to verify that incoming requests genuinely originate
            from your IntuneGet instance.
          </p>
        </Callout>
      </section>

      {/* Export Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Export Tab
        </h2>
        <p className="text-text-secondary mb-4">
          Configure default export preferences used when downloading deployment
          data and reports:
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Export Formats
        </h3>
        <ul className="list-disc list-inside space-y-2 text-text-secondary mb-6">
          <li>
            <strong>CSV</strong> - Comma-separated values, compatible with Excel
            and Google Sheets
          </li>
          <li>
            <strong>JSON</strong> - Structured format ideal for programmatic
            processing
          </li>
          <li>
            <strong>XLSX</strong> - Native Excel format with formatting and
            multiple sheets
          </li>
        </ul>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Additional Options
        </h3>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <strong>Include Application Icons</strong> - Embed base64-encoded
            icons in export files
          </li>
          <li>
            <strong>Include Metadata</strong> - Add deployment dates, version
            history, and assignment information
          </li>
        </ul>
      </section>

      {/* Data Tab */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Data Tab
        </h2>
        <p className="text-text-secondary mb-4">
          Manage cached data, synchronization, and auto-refresh settings:
        </p>

        <div className="space-y-4">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h4 className="font-medium text-text-primary mb-1">Application Cache</h4>
            <p className="text-sm text-text-secondary">
              Cached application data speeds up loading times. Click
              &quot;Clear Cache&quot; to force fresh data on next load.
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h4 className="font-medium text-text-primary mb-1">Force Sync</h4>
            <p className="text-sm text-text-secondary">
              Re-fetch all application data from Intune immediately. Useful
              after making changes directly in the Intune portal.
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h4 className="font-medium text-text-primary mb-1">
              Auto-Refresh Interval
            </h4>
            <p className="text-sm text-text-secondary">
              Configure how often IntuneGet checks for new application data.
              Options: 5 minutes, 15 minutes (default), 30 minutes, or 1 hour.
            </p>
          </div>
        </div>

        <Callout type="info" title="Local Storage">
          <p>
            All cached application data is stored locally in your browser. No
            data is sent to third-party servers. Clearing your browser cache
            will also clear IntuneGet&apos;s cached data.
          </p>
        </Callout>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Next Steps</h2>
        <p className="text-text-secondary mb-4">
          Review the troubleshooting guide for common configuration issues, or
          learn about the Unmanaged Apps feature.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            Troubleshooting
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/unmanaged-apps"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            Unmanaged Apps
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
