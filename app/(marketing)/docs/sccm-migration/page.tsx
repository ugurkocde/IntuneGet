import { Metadata } from "next";
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
  title: "SCCM Migration | IntuneGet Docs",
  description:
    "Import SCCM exports, match apps to WinGet, preview migration, and execute queued deployments.",
  alternates: {
    canonical: "https://intuneget.com/docs/sccm-migration",
  },
  openGraph: {
    title: "SCCM Migration | IntuneGet Docs",
    description:
      "Import SCCM exports, match apps to WinGet, preview migration, and execute queued deployments.",
  },
};

export default function SccmMigrationPage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>SCCM Migration</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Migrate existing SCCM application portfolios into IntuneGet in four
          phases: import, matching, preview, and execution.</T>
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Workflow</T>
        </h2>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary">
          <li><T>Export SCCM apps using <code>/scripts/Export-SCCMApps.ps1</code>.</T></li>
          <li><T>Create a migration and import CSV/JSON from <code>/dashboard/sccm/new</code>.</T></li>
          <li><T>Run automatic matching in <code>/dashboard/sccm/[migrationId]</code>.</T></li>
          <li><T>Review unmatched apps and apply manual mapping/exclusions.</T></li>
          <li><T>Open migration preview and execute from <code>/dashboard/sccm/[migrationId]/migrate</code>.</T></li>
        </ol>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>API Endpoints</T>
        </h2>
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
              <TableCell><code>POST</code></TableCell>
              <TableCell><code>/api/sccm/import</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Import SCCM app data</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>GET</code></TableCell>
              <TableCell><code>/api/sccm/migrations</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>List migrations, single migration, or stats</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POST/PATCH/DELETE</code></TableCell>
              <TableCell><code>/api/sccm/migrations</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Create/update/delete migrations</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>GET/POST/PATCH</code></TableCell>
              <TableCell><code>/api/sccm/match</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Read, run, and adjust matching state</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POST/PATCH</code></TableCell>
              <TableCell><code>/api/sccm/migrate</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Preview/execute migration and update per-app settings</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Status Model</T>
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li><T>Migration statuses include <code>importing</code>, <code>matching</code>, <code>migrating</code>, and <code>ready</code>.</T></li>
          <li><T>Match statuses include <code>pending</code>, <code>matched</code>, <code>partial</code>, <code>unmatched</code>, and <code>excluded</code>.</T></li>
          <li><T>Migration result statuses include <code>queued</code> and <code>failed</code> for app-level outcomes.</T></li>
        </ul>
        <Callout type="warning" title="Execution Prerequisites">
          <p>
            <T>Preview/execution depends on curated app and installer metadata.
            Missing package metadata can block migration.</T>
          </p>
        </Callout>
      </section>
    </div>
  );
}
