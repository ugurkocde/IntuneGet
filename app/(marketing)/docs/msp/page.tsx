import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
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
  alternates: {
    canonical: "https://intuneget.com/docs/msp",
  },
  openGraph: {
    title: "MSP Features | IntuneGet Docs",
    description:
      "Managed Service Provider capabilities in IntuneGet. Multi-tenant batch deployments, team management, webhooks, audit logs, and reports.",
  },
};

export default function MspPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>MSP Features</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Managed Service Provider capabilities for managing multiple client
          tenants, batch deployments, team collaboration, and cross-tenant
          reporting.</T>
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Overview</T></h2>
        <p className="text-text-secondary mb-4">
          <T>The MSP solution is designed for Managed Service Providers and IT
          teams managing multiple Microsoft 365 tenants. It provides a
          centralized dashboard for deploying applications across tenants,
          managing team access, tracking deployments, and generating reports.</T>
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Building2 className="h-6 w-6 text-accent-cyan mb-3" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Multi-Tenant</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Manage and deploy to multiple client tenants from a single
              dashboard</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Users className="h-6 w-6 text-accent-cyan mb-3" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Team Management</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Role-based access control for your team members</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <BarChart3 className="h-6 w-6 text-accent-cyan mb-3" />
            <h3 className="font-semibold text-text-primary mb-1"><T>Reports</T></h3>
            <p className="text-sm text-text-secondary">
              <T>Cross-tenant analytics with exportable reports</T>
            </p>
          </div>
        </div>
      </section>

      {/* Batch Deployments */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Multi-Tenant Batch Deployments</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Deploy applications to multiple client tenants simultaneously using
          the batch deployment wizard. Select an application, choose your target
          tenants, and IntuneGet handles the rest.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Deployment Workflow</T>
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary mb-6">
          <li><T>Select the application to deploy from your inventory or cart</T></li>
          <li><T>Choose one or more target tenants from your registered clients</T></li>
          <li><T>Review and confirm deployment settings per tenant</T></li>
          <li><T>Monitor progress in real-time with the batch progress tracker</T></li>
        </ol>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Progress Tracking</T>
        </h3>
        <p className="text-text-secondary mb-4">
          <T>The BatchProgressTracker component provides live status updates for
          each tenant in the batch, showing download progress, packaging status,
          and upload completion. Failed deployments can be retried individually.</T>
        </p>

        <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
          <h4 className="font-medium text-text-primary mb-2"><T>Cross-Tenant Jobs Table</T></h4>
          <p className="text-sm text-text-secondary">
            <T>View all deployment jobs across tenants in a unified table. Filter by
            tenant, status, or time range. Each job shows its current status,
            duration, and any error messages.</T>
          </p>
        </div>
      </section>

      {/* Tenant Management */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Tenant Management</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Register and manage client tenants through the Add Tenant Flow. Each
          tenant requires admin consent to allow IntuneGet to deploy
          applications on their behalf.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Adding a Tenant</T>
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary mb-6">
          <li><T>Generate a consent URL using the Consent URL Generator</T></li>
          <li><T>Share the URL with the client&apos;s Global Administrator</T></li>
          <li><T>The admin grants consent through the Microsoft consent flow</T></li>
          <li><T>The callback registers the tenant in your MSP organization</T></li>
        </ol>

        <Callout type="info" title="Tenant Switching">
          <p>
            <T>Use the Tenant Switcher component to quickly switch between client
            tenants. The currently selected tenant determines which Intune
            environment you are viewing and deploying to.</T>
          </p>
        </Callout>
      </section>

      {/* Team Management */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Team Management</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Invite team members to your MSP organization and assign roles that
          control their access level. Supports both individual and bulk
          invitations.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3"><T>Roles</T></h3>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Role</T></TableHeader>
              <TableHeader><T>Permissions</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Owner</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Full access, including organization settings, team and role
                management, organization deletion, and all tenant operations</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Admin</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Manage tenants, deploy applications, configure webhooks, view
                reports, and invite team members</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Operator</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Deploy applications to assigned tenants and view deployment
                status and reports</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Viewer</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Read-only access to view tenants, deployments, and reports</T>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Callout type="info" title="Assigning the Owner role">
          <p>
            <T>The Owner role is automatically assigned to the person who creates
            the organization and cannot be transferred or granted to other
            members. This protects the organization from an accidental takeover.
            Admin is the highest role that can be assigned; an Admin has every
            permission except changing member roles and deleting the
            organization, which remain exclusive to the Owner. This works the
            same way in the hosted and self-hosted versions, and there is no
            separate step required to unlock Owner.</T>
          </p>
        </Callout>
      </section>

      {/* Webhooks */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Webhooks</T></h2>
        <p className="text-text-secondary mb-4">
          <T>Configure webhooks at the MSP organization level to receive
          notifications about deployment events across all tenants. Webhooks
          support HMAC signature verification for security.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          <T>Event Types</T>
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Select which events trigger webhook deliveries using the Event Type
          Selector:</T>
        </p>
        <ul className="list-disc list-inside space-y-1 text-text-secondary mb-6">
          <li><T>Deployment started / completed / failed</T></li>
          <li><T>Tenant added / removed</T></li>
          <li><T>Team member invited / role changed</T></li>
          <li><T>Batch deployment progress updates</T></li>
        </ul>

        <h3 className="text-lg font-semibold text-text-primary mb-3"><T>Security</T></h3>
        <p className="text-text-secondary mb-4">
          <T>Each webhook endpoint is signed with an HMAC secret. The receiving
          service can verify the signature to ensure the request originated from
          IntuneGet. Failed deliveries are retried automatically.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3"><T>Delivery Logs</T></h3>
        <p className="text-text-secondary">
          <T>View the delivery history for each webhook, including response status
          codes, delivery times, and any error messages. Use the Webhook
          Delivery Log to debug integration issues.</T>
        </p>
      </section>

      {/* Audit Logs */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Audit Logs</T></h2>
        <p className="text-text-secondary mb-4">
          <T>All MSP operations are recorded in an audit log for compliance and
          troubleshooting. Each entry includes:</T>
        </p>
        <ul className="list-disc list-inside space-y-1 text-text-secondary mb-4">
          <li><T>Action performed and target resource</T></li>
          <li><T>User who performed the action</T></li>
          <li><T>Timestamp</T></li>
          <li><T>IP address and user agent</T></li>
          <li><T>Affected tenant (if applicable)</T></li>
        </ul>
        <p className="text-text-secondary">
          <T>The Audit Log Table supports filtering by action type, user, tenant,
          and date range.</T>
        </p>
      </section>

      {/* Reports */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Reports & Analytics</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>The MSP Reports Dashboard provides cross-tenant analytics and
          visualizations to help you understand deployment patterns and identify
          trends.</T>
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <BarChart3 className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">
              <T>Cross-Tenant Trends</T>
            </h4>
            <p className="text-sm text-text-secondary">
              <T>Visualize deployment activity over time across all tenants</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Building2 className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">
              <T>Deployments by Tenant</T>
            </h4>
            <p className="text-sm text-text-secondary">
              <T>Compare deployment volume and frequency per tenant</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <Shield className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1">
              <T>Tenant Success Rate</T>
            </h4>
            <p className="text-sm text-text-secondary">
              <T>Track success/failure rates per tenant to identify issues</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <FileDown className="h-5 w-5 text-accent-cyan mb-2" />
            <h4 className="font-medium text-text-primary mb-1"><T>Export Options</T></h4>
            <p className="text-sm text-text-secondary">
              <T>Export reports in CSV, JSON, or PDF format</T>
            </p>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3"><T>Next Steps</T></h2>
        <p className="text-text-secondary mb-4">
          <T>Configure notifications and webhooks for your deployments, or review
          the troubleshooting guide for common MSP issues.</T>
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/settings"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            <T>Settings & Webhooks</T>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/troubleshooting"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            <T>Troubleshooting</T>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
