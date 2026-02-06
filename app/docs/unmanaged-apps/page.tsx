import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, SearchX, CheckCircle, AlertCircle, HelpCircle, Shield } from "lucide-react";
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
  title: "Unmanaged Apps | IntuneGet Docs",
  description:
    "Detect and manage unmanaged applications discovered on your Intune-managed devices. Match, claim, and deploy apps automatically.",
};

export default function UnmanagedAppsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Unmanaged Apps Detection
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Discover applications installed on your managed devices that are not
          yet deployed through Intune. Match them to Winget packages and claim
          them for deployment.
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Overview</h2>
        <p className="text-text-secondary mb-4">
          The Unmanaged Apps feature uses the Microsoft Graph API to retrieve
          discovered applications from your Intune-managed devices. It then
          automatically matches these apps against the Winget repository using
          fuzzy name matching and confidence scoring, helping you identify
          software gaps and bring unmanaged applications under Intune management.
        </p>
        <p className="text-text-secondary">
          Microsoft automatically filters out its own applications (e.g.,
          Microsoft Edge, Visual C++ Redistributables) so you can focus on
          third-party software that needs management.
        </p>
      </section>

      {/* Required Permission */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Required Permission
        </h2>

        <div className="rounded-lg border border-black/10 bg-white p-4 flex items-start gap-4">
          <Shield className="h-6 w-6 text-accent-cyan flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-semibold text-text-primary mb-2">
              DeviceManagementManagedDevices.Read.All
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              This permission allows IntuneGet to read discovered application
              data from your Intune-managed devices. A Global Administrator must
              grant admin consent for this permission.
            </p>
            <p className="text-sm text-text-secondary">
              You can verify this permission is granted on the{" "}
              <Link
                href="/docs/settings"
                className="text-accent-cyan hover:underline"
              >
                Settings page
              </Link>{" "}
              under the Permissions tab.
            </p>
          </div>
        </div>

        <Callout type="warning" title="Permission Required">
          <p>
            Without the <code>DeviceManagementManagedDevices.Read.All</code>{" "}
            permission, the Unmanaged Apps page will display a permission error.
            Contact your Global Administrator to grant admin consent.
          </p>
        </Callout>
      </section>

      {/* How Matching Works */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          How Matching Works
        </h2>
        <p className="text-text-secondary mb-4">
          IntuneGet uses a multi-step matching process to identify which Winget
          packages correspond to discovered applications:
        </p>

        <ol className="list-decimal list-inside space-y-3 text-text-secondary mb-6">
          <li>
            <strong>Exact name matching</strong> - Compares the discovered app
            name directly against Winget package names
          </li>
          <li>
            <strong>Fuzzy matching</strong> - Uses string similarity algorithms
            to find close matches even when names differ slightly
          </li>
          <li>
            <strong>Confidence scoring</strong> - Each match receives a
            confidence score from 0% to 100% indicating match quality
          </li>
          <li>
            <strong>Manual linking</strong> - You can manually link unmatched
            apps to specific Winget packages when automatic matching fails
          </li>
        </ol>

        <h3 className="text-lg font-semibold text-text-primary mb-4">Match Statuses</h3>

        <div className="space-y-3">
          <div className="rounded-lg border border-status-success/20 bg-status-success/5 p-4 flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-status-success flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-text-primary">Matched</h4>
              <p className="text-sm text-text-secondary mt-1">
                A high-confidence match was found in the Winget repository. The
                app can be claimed and deployed immediately. Confidence score is
                typically above 80%.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-text-primary">Partial Match</h4>
              <p className="text-sm text-text-secondary mt-1">
                A possible match was found but with lower confidence. Review the
                suggested package to verify it is correct before claiming, or
                use the Link Package option to manually assign the correct
                Winget package.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-black/10 bg-black/5 p-4 flex items-start gap-3">
            <HelpCircle className="h-5 w-5 text-text-muted flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-text-primary">No Match</h4>
              <p className="text-sm text-text-secondary mt-1">
                No corresponding Winget package was found. This may be a custom
                or proprietary application. You can manually link it to a Winget
                package if one exists but was not automatically detected.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Claiming Apps */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Claiming Applications
        </h2>
        <p className="text-text-secondary mb-4">
          Claiming an application adds it to your deployment cart with
          pre-configured settings based on the matched Winget package. IntuneGet
          automatically generates detection rules, install/uninstall commands,
          and PSADT configuration.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Individual Claiming
        </h3>
        <p className="text-text-secondary mb-4">
          Click the Claim button on any matched application card to add it to
          your deployment cart. IntuneGet will fetch the package manifest,
          determine the best installer, and configure all deployment settings
          automatically.
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Bulk Claiming (Claim All)
        </h3>
        <p className="text-text-secondary mb-4">
          Use the &quot;Claim All&quot; button in the toolbar to claim all
          matched applications at once. This processes apps in batches of 5 for
          optimal performance. A progress modal shows the status of each app
          being claimed.
        </p>

        <Callout type="info" title="Claim Status">
          <p>
            Each claim operation is tracked with a status: pending, success, or
            failed. Failed claims can be retried individually. Successfully
            claimed apps appear in your deployment cart ready for packaging and
            upload.
          </p>
        </Callout>
      </section>

      {/* Manual Linking */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Linking Packages Manually
        </h2>
        <p className="text-text-secondary mb-4">
          For apps with no match or an incorrect match, you can manually link
          them to a Winget package:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary">
          <li>Click the Link Package button on the app card</li>
          <li>Search for the correct Winget package by name or ID</li>
          <li>Select the package to create the mapping</li>
          <li>
            The mapping is saved and will be used for future syncs, upgrading the
            match status to Matched with 100% confidence
          </li>
        </ol>
      </section>

      {/* Filtering and Views */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Filtering and Views
        </h2>

        <h3 className="text-lg font-semibold text-text-primary mb-3">Filter Options</h3>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Filter</TableHeader>
              <TableHeader>Options</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Search</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Filter by app name, publisher, or matched package ID
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                Match Status
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                All, Matched, Partial Match, No Match
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Sort By</TableCell>
              <TableCell className="text-sm text-text-secondary">
                Device Count, Name, Publisher, Match Status (ascending or descending)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                Show Claimed
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                Toggle to show or hide already-claimed applications
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
          View Modes
        </h3>
        <p className="text-text-secondary">
          Toggle between <strong>Grid view</strong> (card layout with detailed
          information) and <strong>List view</strong> (compact table layout for
          quick scanning). The toolbar provides a view toggle switch.
        </p>
      </section>

      {/* Stats */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Statistics Dashboard
        </h2>
        <p className="text-text-secondary mb-4">
          The top of the Unmanaged Apps page displays key statistics:
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h4 className="font-medium text-text-primary mb-1">Total Apps</h4>
            <p className="text-sm text-text-secondary">
              Number of non-Microsoft discovered applications
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h4 className="font-medium text-text-primary mb-1">Match Breakdown</h4>
            <p className="text-sm text-text-secondary">
              Count of matched, partial, and unmatched apps
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h4 className="font-medium text-text-primary mb-1">Total Devices</h4>
            <p className="text-sm text-text-secondary">
              Combined device count across all discovered apps
            </p>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Next Steps</h2>
        <p className="text-text-secondary mb-4">
          Learn about MSP features for managing unmanaged apps across multiple
          tenants, or configure notifications for new discoveries.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/msp"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            MSP Features
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/settings"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            Settings & Webhooks
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
