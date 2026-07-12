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
  title: "API Reference | IntuneGet Docs",
  description:
    "Endpoint overview for IntuneGet APIs grouped by feature area.",
  alternates: {
    canonical: "https://intuneget.com/docs/api-reference",
  },
  openGraph: {
    title: "API Reference | IntuneGet Docs",
    description:
      "Endpoint overview for IntuneGet APIs grouped by feature area.",
  },
};

export default function ApiReferencePage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>API Reference</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>High-level endpoint map for package orchestration, Intune inventory,
          updates, SCCM migration, community features, notifications, and MSP
          operations.</T>
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Authentication</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Most routes require a Microsoft access token:</T>
        </p>
        <pre className="rounded-lg border border-overlay/10 bg-bg-elevated p-4 text-sm text-text-secondary overflow-x-auto">
{`Authorization: Bearer <microsoft-access-token>`}
        </pre>
        <Callout type="info" title="Callback Security">
          <p>
            <T>Pipeline callbacks use HMAC verification when{" "}
            <code>CALLBACK_SECRET</code> is configured.</T>
          </p>
        </Callout>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Core Domains</T>
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Domain</T></TableHeader>
              <TableHeader><T>Primary Routes</T></TableHeader>
              <TableHeader><T>Purpose</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Package Pipeline</T></TableCell>
              <TableCell><code>/api/package*</code>, <code>/api/packager/*</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Queue, track, cancel, and process packaging jobs</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Intune Inventory</T></TableCell>
              <TableCell><code>/api/intune/apps</code>, <code>/api/intune/apps/[id]</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Read Win32 app inventory and assignments</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Analytics</T></TableCell>
              <TableCell><code>/api/analytics</code>, <code>/api/analytics/export</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Dashboard metrics and CSV exports</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Updates</T></TableCell>
              <TableCell><code>/api/updates/*</code>, <code>/api/update-policies/*</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Update discovery, triggers, and policy management</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>SCCM Migration</T></TableCell>
              <TableCell><code>/api/sccm/*</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Import, match, preview, and execute SCCM migration workflows</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Community</T></TableCell>
              <TableCell><code>/api/community/*</code>, <code>/api/apps/[id]/rate</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Suggestions, voting, ratings, and detection feedback</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>MSP</T></TableCell>
              <TableCell><code>/api/msp/*</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Multi-tenant org, team, jobs, reports, and webhooks</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Related Docs</T>
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <Link href="/docs/environment-reference" className="text-accent-cyan hover:underline">
              <T>Environment Reference</T>
            </Link>
          </li>
          <li>
            <Link href="/docs/sccm-migration" className="text-accent-cyan hover:underline">
              <T>SCCM Migration</T>
            </Link>
          </li>
          <li>
            <Link href="/docs/updates-policies" className="text-accent-cyan hover:underline">
              <T>Updates & Policies</T>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
