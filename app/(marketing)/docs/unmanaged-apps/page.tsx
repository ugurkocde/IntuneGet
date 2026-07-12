import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
import { ArrowRight, SearchX, CheckCircle, AlertCircle, HelpCircle, Shield, RefreshCw } from "lucide-react";
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
  alternates: {
    canonical: "https://intuneget.com/docs/unmanaged-apps",
  },
  openGraph: {
    title: "Unmanaged Apps | IntuneGet Docs",
    description:
      "Detect and manage unmanaged applications discovered on your Intune-managed devices. Match, claim, and deploy apps automatically.",
  },
};

export default function UnmanagedAppsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Unmanaged Apps Detection</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Discover applications installed on your managed devices that are not
          yet deployed through Intune. Match them to Winget packages and claim
          them for deployment.</T>
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Overview</T></h2>
        <p className="text-text-secondary mb-4">
          <T>The Unmanaged Apps feature uses the Microsoft Graph API to retrieve
          discovered applications from your Intune-managed devices. It then
          automatically matches these apps against the Winget repository using
          fuzzy name matching and confidence scoring, helping you identify
          software gaps and bring unmanaged applications under Intune management.</T>
        </p>
        <p className="text-text-secondary">
          <T>Microsoft automatically filters out its own applications (e.g.,
          Microsoft Edge, Visual C++ Redistributables) so you can focus on
          third-party software that needs management.</T>
        </p>
      </section>

      {/* Required Permission */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Required Permission</T>
        </h2>

        <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4 flex items-start gap-4">
          <Shield className="h-6 w-6 text-accent-cyan flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-semibold text-text-primary mb-2">
              DeviceManagementManagedDevices.Read.All
            </h3>
            <p className="text-sm text-text-secondary mb-3">
              <T>This permission allows IntuneGet to read discovered application
              data from your Intune-managed devices. A Global Administrator must
              grant admin consent for this permission.</T>
            </p>
            <p className="text-sm text-text-secondary">
              <T>You can verify this permission is granted on the{" "}
              <Link
                href="/docs/settings"
                className="text-accent-cyan hover:underline"
              >
                Settings page
              </Link>{" "}
              under the Permissions tab.</T>
            </p>
          </div>
        </div>

        <Callout type="warning" title="Permission Required">
          <p>
            <T>Without the <code>DeviceManagementManagedDevices.Read.All</code>{" "}
            permission, the Unmanaged Apps page will display a permission error.
            Contact your Global Administrator to grant admin consent.</T>
          </p>
        </Callout>
      </section>

      {/* How Matching Works */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>How Matching Works</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>IntuneGet uses a multi-step matching process to identify which Winget
          packages correspond to discovered applications:</T>
        </p>

        <ol className="list-decimal list-inside space-y-3 text-text-secondary mb-6">
          <li>
            <T><strong>Exact name matching</strong> - Compares the discovered app
            name directly against Winget package names</T>
          </li>
          <li>
            <T><strong>Fuzzy matching</strong> - Uses string similarity algorithms
            to find close matches even when names differ slightly</T>
          </li>
          <li>
            <T><strong>Confidence scoring</strong> - Each match receives a
            confidence score from 0% to 100% indicating match quality</T>
          </li>
          <li>
            <T><strong>Manual linking</strong> - You can manually link unmatched
            apps to specific Winget packages when automatic matching fails</T>
          </li>
        </ol>

        <h3 className="text-lg font-semibold text-text-primary mb-4"><T>Match Statuses</T></h3>

        <div className="space-y-3">
          <div className="rounded-lg border border-status-success/20 bg-status-success/5 p-4 flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-status-success flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-text-primary"><T>Matched</T></h4>
              <p className="text-sm text-text-secondary mt-1">
                <T>A high-confidence match was found in the Winget repository. The
                app can be claimed and deployed immediately. Confidence score is
                typically above 80%.</T>
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-text-primary"><T>Partial Match</T></h4>
              <p className="text-sm text-text-secondary mt-1">
                <T>A possible match was found but with lower confidence. Review the
                suggested package to verify it is correct before claiming, or
                use the Link Package option to manually assign the correct
                Winget package.</T>
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-overlay/5 p-4 flex items-start gap-3">
            <HelpCircle className="h-5 w-5 text-text-muted flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-text-primary"><T>No Match</T></h4>
              <p className="text-sm text-text-secondary mt-1">
                <T>No corresponding Winget package was found. This may be a custom
                or proprietary application. You can manually link it to a Winget
                package if one exists but was not automatically detected.</T>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Claiming Apps */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Claiming Applications</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Claiming an application adds it to your deployment cart with
          pre-configured settings based on the matched Winget package. IntuneGet
          automatically generates detection rules, install/uninstall commands,
          and PSADT configuration.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Individual Claiming
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Click the Claim button on any matched application card to add it to
          your deployment cart. IntuneGet will fetch the package manifest,
          determine the best installer, and configure all deployment settings
          automatically.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Bulk Claiming (Claim All)
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Use the &quot;Claim All&quot; button in the toolbar to claim all
          matched applications at once. This processes apps in batches of 5 for
          optimal performance. A progress modal shows the status of each app
          being claimed.</T>
        </p>

        <Callout type="info" title="Claim Status">
          <p>
            <T>Each claim operation is tracked with a status: pending, success, or
            failed. Failed claims can be retried individually. Successfully
            claimed apps appear in your deployment cart ready for packaging and
            upload.</T>
          </p>
        </Callout>
      </section>

      {/* Manual Linking */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Linking Packages Manually</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>For apps with no match or an incorrect match, you can manually link
          them to a Winget package:</T>
        </p>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary">
          <li><T>Click the Link Package button on the app card</T></li>
          <li><T>Search for the correct Winget package by name or ID</T></li>
          <li><T>Select the package to create the mapping</T></li>
          <li>
            The mapping is saved and will be used for future syncs, upgrading the
            match status to Matched with 100% confidence
          </li>
        </ol>
      </section>

      {/* Filtering and Views */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Filtering and Views</T>
        </h2>

        <h3 className="text-lg font-semibold text-text-primary mb-3"><T>Filter Options</T></h3>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Filter</T></TableHeader>
              <TableHeader><T>Options</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Search</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Filter by app name, publisher, or matched package ID</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                <T>Match Status</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>All, Matched, Partial Match, No Match</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Sort By</T></TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Device Count, Name, Publisher, Match Status (ascending or descending)</T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">
                <T>Show Claimed</T>
              </TableCell>
              <TableCell className="text-sm text-text-secondary">
                <T>Toggle to show or hide already-claimed applications</T>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
          View Modes
        </h3>
        <p className="text-text-secondary">
          <T>Toggle between <strong>Grid view</strong> (card layout with detailed
          information) and <strong>List view</strong> (compact table layout for
          quick scanning). The toolbar provides a view toggle switch.</T>
        </p>
      </section>

      {/* Stats */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Statistics Dashboard</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>The top of the Unmanaged Apps page displays key statistics:</T>
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h4 className="font-medium text-text-primary mb-1"><T>Total Apps</T></h4>
            <p className="text-sm text-text-secondary">
              <T>Number of non-Microsoft discovered applications</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h4 className="font-medium text-text-primary mb-1"><T>Match Breakdown</T></h4>
            <p className="text-sm text-text-secondary">
              <T>Count of matched, partial, and unmatched apps</T>
            </p>
          </div>
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h4 className="font-medium text-text-primary mb-1"><T>Total Devices</T></h4>
            <p className="text-sm text-text-secondary">
              <T>Combined device count across all discovered apps</T>
            </p>
          </div>
        </div>
      </section>

      {/* Update Only Assignments */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <RefreshCw className="h-5 w-5 text-amber-400" />
          </div>
          <h2 className="text-2xl font-semibold text-text-primary">
            Update Only Assignments
          </h2>
        </div>
        <p className="text-text-secondary mb-4">
          <T>When deploying claimed apps, you can assign them with an &quot;Update
          Only&quot; intent. This is particularly useful for discovered apps: instead
          of force-installing the app on every targeted device, it only updates
          devices where the app is already present.</T>
        </p>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          How It Works
        </h3>
        <p className="text-text-secondary mb-4">
          <T>Selecting &quot;Update Only&quot; tells IntuneGet to assign the app as
          &quot;required&quot; in Intune but with an additional{" "}
          <strong>requirement rule</strong> that checks whether the app already
          exists on the device. Intune then evaluates two conditions:</T>
        </p>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary mb-6">
          <li>
            <strong>Requirement met</strong> (app exists on the device) AND{" "}
            <strong>detection not met</strong> (new version not yet installed) --
            Intune proceeds with the update
          </li>
          <li>
            <strong>Requirement not met</strong> (app not on the device) -- Intune
            skips the device entirely
          </li>
          <li>
            <strong>Requirement met AND detection met</strong> (app exists and is
            already up to date) -- device reports as compliant
          </li>
        </ol>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          Intune Evaluation Matrix
        </h3>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>App Already Installed?</T></TableHeader>
              <TableHeader><T>New Version Installed?</T></TableHeader>
              <TableHeader><T>Result</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="text-text-secondary"><T>No</T></TableCell>
              <TableCell className="text-text-secondary">No</TableCell>
              <TableCell>
                <span className="text-text-muted"><T>Skipped -- requirement not met</T></span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-text-secondary">Yes</TableCell>
              <TableCell className="text-text-secondary">No</TableCell>
              <TableCell>
                <span className="text-status-success"><T>Updated -- requirement met, detection not met</T></span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-text-secondary">Yes</TableCell>
              <TableCell className="text-text-secondary">Yes</TableCell>
              <TableCell>
                <span className="text-accent-cyan"><T>Compliant -- already up to date</T></span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <h3 className="text-lg font-semibold text-text-primary mt-6 mb-3">
          Configuring Update Only
        </h3>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary mb-6">
          <li>Claim an unmanaged app (or add any app to your cart)</li>
          <li>Open the app configuration and expand &quot;Assignment Configuration&quot;</li>
          <li>Enable assignments and add a target (All Devices, All Users, or an Entra ID group)</li>
          <li>
            Select <strong>Update Only</strong> from the intent dropdown -- the
            badge turns amber
          </li>
          <li>An info banner explains the behavior</li>
          <li>Save and deploy -- requirement rules are generated automatically</li>
        </ol>

        <h3 className="text-lg font-semibold text-text-primary mb-3">
          How Detection Works
        </h3>
        <p className="text-text-secondary mb-4">
          <T>The requirement rule detects the app using standard Windows uninstall
          registry methods, not the IntuneGet registry marker. This means it
          works for apps that were installed outside of IntuneGet (which is
          exactly the case for discovered/unmanaged apps):</T>
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary mb-6">
          <li>
            <strong>MSI apps with product codes:</strong> A registry requirement
            rule checks the product code&apos;s uninstall key directly
          </li>
          <li>
            <strong>All other apps:</strong> A PowerShell script searches both
            HKLM and HKCU uninstall registry paths by display name
          </li>
        </ul>

        <Callout type="warning" title="Requirement Rules Are App-Level">
          <p>
            Intune requirement rules apply to the entire app, not to individual
            assignments. If you mix &quot;Update Only&quot; with other intents
            (such as Required or Available) on the same app, the existence check
            will gate <strong>all</strong> assignments -- meaning even the
            Required assignments will only install on devices where the app
            already exists. A warning banner appears in the UI when this
            situation is detected.
          </p>
        </Callout>

        <Callout type="info" title="How It Appears in Intune">
          <p>
            The Intune portal will show the assignment as &quot;Required&quot;
            because &quot;Update Only&quot; is an IntuneGet concept -- there is
            no native &quot;update only&quot; intent in Intune. The additional
            requirement rule is what limits the installation to devices that
            already have the app.
          </p>
        </Callout>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3"><T>Next Steps</T></h2>
        <p className="text-text-secondary mb-4">
          <T>Learn about MSP features for managing unmanaged apps across multiple
          tenants, or configure notifications for new discoveries.</T>
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/msp"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            <T>MSP Features</T>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/settings"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            <T>Settings & Webhooks</T>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
