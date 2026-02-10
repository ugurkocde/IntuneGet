import { Metadata } from "next";
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
  title: "Environment Reference | IntuneGet Docs",
  description:
    "Complete environment variable reference for IntuneGet web app and local packager modes.",
};

export default function EnvironmentReferencePage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Environment Reference
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Consolidated variable reference for deployment modes, packaging modes,
          and optional integrations.
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Core Web App Variables
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Variable</TableHeader>
              <TableHeader>Required</TableHeader>
              <TableHeader>Notes</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>DATABASE_MODE</code></TableCell>
              <TableCell>Yes</TableCell>
              <TableCell className="text-sm text-text-secondary"><code>supabase</code> or <code>sqlite</code></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>PACKAGER_MODE</code></TableCell>
              <TableCell>Yes</TableCell>
              <TableCell className="text-sm text-text-secondary"><code>github</code> or <code>local</code></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>NEXT_PUBLIC_AZURE_AD_CLIENT_ID</code></TableCell>
              <TableCell>Yes</TableCell>
              <TableCell className="text-sm text-text-secondary">Entra app client ID. In Docker deployments, this is injected at runtime -- no build args needed.</TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>AZURE_AD_CLIENT_SECRET</code></TableCell>
              <TableCell>Yes*</TableCell>
              <TableCell className="text-sm text-text-secondary"><code>AZURE_CLIENT_SECRET</code> is also supported</TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>NEXT_PUBLIC_URL</code></TableCell>
              <TableCell>Yes</TableCell>
              <TableCell className="text-sm text-text-secondary">Public app URL</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Mode-Specific Variables
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Mode</TableHeader>
              <TableHeader>Required Variables</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Supabase DB</TableCell>
              <TableCell>
                <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{" "}
                <code>SUPABASE_SERVICE_ROLE_KEY</code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">SQLite DB</TableCell>
              <TableCell>
                <code>PACKAGER_API_KEY</code> (with local packager), optional{" "}
                <code>DATABASE_PATH</code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">GitHub Packager</TableCell>
              <TableCell>
                <code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
                <code>GITHUB_WORKFLOWS_REPO</code>, optional{" "}
                <code>GITHUB_REPO</code>, <code>GITHUB_REF</code>,{" "}
                <code>GITHUB_WORKFLOW_FILE</code>, <code>CALLBACK_SECRET</code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary">Local Packager</TableCell>
              <TableCell>
                <code>PACKAGER_MODE=local</code> plus shared{" "}
                <code>PACKAGER_API_KEY</code> strategy
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Packager Service Variables
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Variable</TableHeader>
              <TableHeader>Use</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>AZURE_CLIENT_ID</code> / <code>AZURE_CLIENT_SECRET</code></TableCell>
              <TableCell className="text-sm text-text-secondary">Required for Graph and Intune operations</TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>INTUNEGET_API_URL</code> + <code>PACKAGER_API_KEY</code></TableCell>
              <TableCell className="text-sm text-text-secondary">API mode (recommended for sqlite web mode)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_ROLE_KEY</code></TableCell>
              <TableCell className="text-sm text-text-secondary">Supabase mode</TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POLL_INTERVAL</code>, <code>STALE_JOB_TIMEOUT</code></TableCell>
              <TableCell className="text-sm text-text-secondary">Polling and stale-claim behavior</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <Callout type="tip" title="Validation Order">
          <p>
            Confirm database mode first, then packager mode. Most setup issues
            come from mixing sqlite/supabase variables or missing packager auth
            key alignment.
          </p>
        </Callout>
      </section>
    </div>
  );
}
