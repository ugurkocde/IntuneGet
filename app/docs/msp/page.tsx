import { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Users,
  Webhook,
  Shield,
  BarChart3,
  FileDown,
  Clock,
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
  title: "MSP Features | IntuneGet Docs",
  description:
    "Managed Service Provider capabilities in IntuneGet. Multi-tenant batch deployments, team management, webhooks, audit logs, and reports.",
};

export default function MspPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          MSP Features
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Managed Service Provider capabilities for managing multiple client
          tenants, batch deployments, team collaboration, and cross-tenant
          reporting.
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Overview</h2>
        <p className="text-text-secondary mb-4">
          The MSP solution is designed for Managed Service Providers and IT
          teams managing multiple Microsoft 365 tenants. It provides a
          centralized dashboard for deploying applications across tenants,
          managing team access, tracking deployments, and generating reports.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Building2 className="h-6 w-6 text-accent-cyan mb-3" />
            <h3 className="font-semibold text-text-primary mb-1">Multi-Tenant</h3>
            <p className="text-sm text-text-secondary">
              Manage and deploy to multiple client tenants from a single
              dashboard
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Users className="h-6 w-6 text-accent-cyan mb-3" />
            <h3 className="font-semibold text-text-primary mb-1">Team Management</h3>
            <p className="text-sm text-text-secondary">
              Role-based access control for your team members
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <BarChart3 className="h-6 w-6 text-accent-cyan mb-3" />
            <h3 className="font-semibold text-text-primary mb-1">Reports</h3>
            <p className="text-sm text-text-secondary">
              Cross-tenant analytics with exportable reports
            </p>
          </div>
        </div>
      </section>

      {/* Batch Deployments */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Multi-Tenant Batch Deployments
        </h2>
        <p className="text-text-secondary mb-4">
          Deploy applications to multiple client tenants simultaneously using
          the batch deployment wizard. Select an application, choose your target
          tenants, and IntuneGet handles the rest.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Deployment Workflow
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary mb-6">
          <li>Select the application to deploy from your inventory or cart</li>
          <li>Choose one or more target tenants from your registered clients</li>
          <li>Review and confirm deployment settings per tenant</li>
          <li>
            Monitor progress in real-time with the batch progress tracker
          </li>
        </ol>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Progress Tracking
        </h3>
        <p className="text-text-secondary mb-4">
          The BatchProgressTracker component provides live status updates for
          each tenant in the batch, showing download progress, packaging status,
          and upload completion. Failed deployments can be retried individually.
        </p>

        <div className="rounded-lg border border-black/10 bg-white p-4">
          <h4 className="font-medium text-text-primary mb-2">Cross-Tenant Jobs Table</h4>
          <p className="text-sm text-text-secondary">
            View all deployment jobs across tenants in a unified table. Filter by
            tenant, status, or time range. Each job shows its current status,
            duration, and any error messages.
          </p>
        </div>
      </section>

      {/* Tenant Management */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Tenant Management
        </h2>
        <p className="text-text-secondary mb-4">
          Register and manage client tenants through the Add Tenant Flow. Each
          tenant requires admin consent to allow IntuneGet to deploy
          applications on their behalf.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Adding a Tenant
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary mb-6">
          <li>
            Generate a consent URL using the Consent URL Generator
          </li>
          <li>
            Share the URL with the client&apos;s Global Administrator
          </li>
          <li>The admin grants consent through the Microsoft consent flow</li>
          <li>
            The callback registers the tenant in your MSP organization
          </li>
        </ol>

        <Callout type="info" title="Tenant Switching">
          <p>
            Use the Tenant Switcher component to quickly switch between client
            tenants. The currently selected tenant determines which Intune
            environment you are viewing and deploying to.
          </p>
        </Callout>
      </section>

      {/* Team Management */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Team Management
        </h2>
        <p className="text-text-secondary mb-4">
          Invite team members to your MSP organization and assign roles that
          control their access level. Supports both individual and bulk
          invitations.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">Roles</h3>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Role</TableHeader>
              <TableHeader>Permissions</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Owner</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Full access including organization settings, billing, team
                management, and all tenant operations
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Admin</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Manage tenants, deploy applications, configure webhooks, view
                reports, and invite team members
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Operator</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Deploy applications to assigned tenants and view deployment
                status and reports
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Viewer</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Read-only access to view tenants, deployments, and reports
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Webhooks */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Webhooks</h2>
        <p className="text-text-secondary mb-4">
          Configure webhooks at the MSP organization level to receive
          notifications about deployment events across all tenants. Webhooks
          support HMAC signature verification for security.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Event Types
        </h3>
        <p className="text-text-secondary mb-4">
          Select which events trigger webhook deliveries using the Event Type
          Selector:
        </p>
        <ul className="list-disc list-inside space-y-1 text-text-secondary mb-6">
          <li>Deployment started / completed / failed</li>
          <li>Tenant added / removed</li>
          <li>Team member invited / role changed</li>
          <li>Batch deployment progress updates</li>
        </ul>

        <h3 className="text-lg font-semibold text-text-primary mb-3">Security</h3>
        <p className="text-text-secondary mb-4">
          Each webhook endpoint is signed with an HMAC secret. The receiving
          service can verify the signature to ensure the request originated from
          IntuneGet. Failed deliveries are retried automatically.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">Delivery Logs</h3>
        <p className="text-text-secondary">
          View the delivery history for each webhook, including response status
          codes, delivery times, and any error messages. Use the Webhook
          Delivery Log to debug integration issues.
        </p>
      </section>

      {/* Audit Logs */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Audit Logs</h2>
        <p className="text-text-secondary mb-4">
          All MSP operations are recorded in an audit log for compliance and
          troubleshooting. Each entry includes:
        </p>
        <ul className="list-disc list-inside space-y-1 text-text-secondary mb-4">
          <li>Action performed and target resource</li>
          <li>User who performed the action</li>
          <li>Timestamp</li>
          <li>IP address and user agent</li>
          <li>Affected tenant (if applicable)</li>
        </ul>
        <p className="text-text-secondary">
          The Audit Log Table supports filtering by action type, user, tenant,
          and date range.
        </p>
      </section>

      {/* Reports */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Reports & Analytics
        </h2>
        <p className="text-text-secondary mb-4">
          The MSP Reports Dashboard provides cross-tenant analytics and
          visualizations to help you understand deployment patterns and identify
          trends.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <BarChart3 className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">
              Cross-Tenant Trends
            </h4>
            <p className="text-sm text-text-secondary">
              Visualize deployment activity over time across all tenants
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Building2 className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">
              Deployments by Tenant
            </h4>
            <p className="text-sm text-text-secondary">
              Compare deployment volume and frequency per tenant
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <Shield className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">
              Tenant Success Rate
            </h4>
            <p className="text-sm text-text-secondary">
              Track success/failure rates per tenant to identify issues
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <FileDown className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">Export Options</h4>
            <p className="text-sm text-text-secondary">
              Export reports in CSV, JSON, or PDF format
            </p>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Next Steps</h2>
        <p className="text-text-secondary mb-4">
          Configure notifications and webhooks for your deployments, or review
          the troubleshooting guide for common MSP issues.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/settings"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            Settings & Webhooks
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            Troubleshooting
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
