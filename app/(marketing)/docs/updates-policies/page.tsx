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
  title: "Updates & Policies | IntuneGet Docs",
  description:
    "Available updates, update trigger flow, policy types, and history for IntuneGet.",
  alternates: {
    canonical: "https://intuneget.com/docs/updates-policies",
  },
  openGraph: {
    title: "Updates & Policies | IntuneGet Docs",
    description:
      "Available updates, update trigger flow, policy types, and history for IntuneGet.",
  },
};

export default function UpdatesPoliciesPage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Updates & Policies</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Configure update behavior per app and tenant, trigger updates
          manually, and audit the full update execution history.</T>
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Policy Types</T>
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Type</T></TableHeader>
              <TableHeader><T>Behavior</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>auto_update</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Automatically triggers updates using saved deployment configuration</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>notify</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Shows update availability without auto deployment</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>ignore</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Suppresses update actions for the app</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>pin_version</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Pins app to a specific version</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Endpoints</T>
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
              <TableCell><code>GET/PATCH</code></TableCell>
              <TableCell><code>/api/updates/available</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Read available updates and dismiss/restore entries</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POST</code></TableCell>
              <TableCell><code>/api/updates/trigger</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Trigger single/bulk updates (max 10 per request)</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>GET</code></TableCell>
              <TableCell><code>/api/updates/history</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Read auto-update history and statuses</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>GET/POST</code></TableCell>
              <TableCell><code>/api/update-policies</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>List and upsert policies</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>GET/PATCH/DELETE</code></TableCell>
              <TableCell><code>/api/update-policies/[id]</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Read, modify, or delete a specific policy</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Trigger Behavior</T>
        </h2>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary">
          <li><T>Validates requested app update records for user + tenant context.</T></li>
          <li><T>Ensures a policy exists (or derives one from prior deployment data).</T></li>
          <li><T>Temporarily enforces auto-update for manual run execution.</T></li>
          <li><T>Creates update history and packaging job records.</T></li>
          <li><T>Restores original policy mode when manual trigger completes.</T></li>
        </ol>
        <Callout type="info" title="Safety Controls">
          <p>
            <T>Update logic applies failure thresholds, cooldown windows, and rate
            caps to reduce deployment risk.</T>
          </p>
        </Callout>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Assignment Intents</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>When deploying an app (or triggering an update), IntuneGet supports
          four assignment intents that control how Intune installs the package:</T>
        </p>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Intent</T></TableHeader>
              <TableHeader><T>Behavior</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>Required</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Automatically installs the app on all targeted devices</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>Available</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Makes the app available in Company Portal for users to install on demand</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>Uninstall</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Removes the app from targeted devices</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>Update Only</code></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Assigns as required but adds a requirement rule so that only
                devices where the app is already installed receive the update</T>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <Callout type="info" title="Update Only for Discovered Apps">
          <p>
            <T>The Update Only intent is especially useful for{" "}
            <Link
              href="/docs/unmanaged-apps"
              className="text-accent-cyan hover:underline"
            >
              discovered/unmanaged apps
            </Link>
            . It updates existing installations without force-installing the app
            on devices that do not already have it. See the Unmanaged Apps
            documentation for full details on how requirement rules are
            generated and the app-level caveat when mixing intents.</T>
          </p>
        </Callout>
      </section>
    </div>
  );
}
