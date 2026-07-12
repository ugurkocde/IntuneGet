import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Callout,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "Inventory, Reports, and Uploads | IntuneGet Docs",
  description:
    "Operational documentation for inventory browsing, reporting, and upload job tracking.",
  alternates: {
    canonical: "https://intuneget.com/docs/inventory-reports-uploads",
  },
  openGraph: {
    title: "Inventory, Reports, and Uploads | IntuneGet Docs",
    description:
      "Operational documentation for inventory browsing, reporting, and upload job tracking.",
  },
};

export default function InventoryReportsUploadsPage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Inventory, Reports, and Uploads</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Operational dashboards for day-to-day management: what is deployed,
          how deployment quality trends over time, and how packaging jobs are
          progressing.</T>
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Inventory</T>
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li><T>Route: <code>/dashboard/inventory</code></T></li>
          <li><T>Search, sort, and grid/list view for Intune Win32 apps</T></li>
          <li><T>App details panel includes assignment information and intent types (Required, Available, Uninstall)</T></li>
          <li><T>Endpoints: <code>GET /api/intune/apps</code>, <code>GET /api/intune/apps/[id]</code></T></li>
        </ul>
        <Callout type="info" title="Assignment Intents">
          <p>
            <T>When configuring app assignments before deployment, IntuneGet
            supports four intents: <strong>Required</strong>,{" "}
            <strong>Available</strong>, <strong>Uninstall</strong>, and{" "}
            <strong>Update Only</strong>. The Update Only intent assigns the app
            as required but adds a requirement rule so that only devices where
            the app is already installed receive the update. See the{" "}
            <Link
              href="/docs/unmanaged-apps#update-only-assignments"
              className="text-accent-cyan hover:underline"
            >
              Unmanaged Apps documentation
            </Link>{" "}
            for details.</T>
          </p>
        </Callout>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Reports</T>
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li><T>Route: <code>/dashboard/reports</code></T></li>
          <li><T>Date range presets: 7, 30, 90, 365 days</T></li>
          <li><T>Summary cards, trend chart, top apps, and recent failures</T></li>
          <li><T>CSV export support</T></li>
          <li><T>Endpoints: <code>GET /api/analytics</code>, <code>GET /api/analytics/export</code></T></li>
        </ul>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Uploads</T>
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li><T>Route: <code>/dashboard/uploads</code></T></li>
          <li><T>Active/completed/failed views for packaging lifecycle states</T></li>
          <li><T>Auto-refresh while active jobs are present</T></li>
          <li><T>Cancel/dismiss and force-redeploy actions</T></li>
        </ul>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Method</T></TableHeader>
              <TableHeader><T>Path</T></TableHeader>
              <TableHeader><T>Purpose</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>GET</code></TableCell>
              <TableCell><code>/api/package</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>List jobs by user or fetch one job</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POST</code></TableCell>
              <TableCell><code>/api/package</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Queue package jobs</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POST</code></TableCell>
              <TableCell><code>/api/package/cancel</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Cancel or dismiss jobs</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POST</code></TableCell>
              <TableCell><code>/api/package/callback</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Pipeline status callback updates</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <Callout type="warning" title="Operational Notes">
          <p>
            <T>Inventory and report routes require bearer auth. Upload list reads
            currently use query-based user scoping in the route handler.</T>
          </p>
        </Callout>
      </section>
    </div>
  );
}
