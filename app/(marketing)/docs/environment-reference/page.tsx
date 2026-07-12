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
  title: "Environment Reference | IntuneGet Docs",
  description:
    "Complete environment variable reference for IntuneGet web app and local packager modes.",
  alternates: {
    canonical: "https://intuneget.com/docs/environment-reference",
  },
  openGraph: {
    title: "Environment Reference | IntuneGet Docs",
    description:
      "Complete environment variable reference for IntuneGet web app and local packager modes.",
  },
};

export default function EnvironmentReferencePage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Environment Reference</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Consolidated variable reference for deployment modes, packaging modes,
          and optional integrations.</T>
        </p>
      </div>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Core Web App Variables</T>
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Variable</T></TableHeader>
              <TableHeader><T>Required</T></TableHeader>
              <TableHeader><T>Notes</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>DATABASE_MODE</code></TableCell>
              <TableCell><T>Yes</T></TableCell>
              <TableCell className="text-sm text-text-secondary"><code>supabase</code> or <code>sqlite</code></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>PACKAGER_MODE</code></TableCell>
              <TableCell><T>Yes</T></TableCell>
              <TableCell className="text-sm text-text-secondary"><code>github</code> or <code>local</code></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>NEXT_PUBLIC_AZURE_AD_CLIENT_ID</code></TableCell>
              <TableCell><T>Yes</T></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Entra app client ID. In Docker deployments, this is injected at runtime -- no build args needed.</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>AZURE_AD_CLIENT_SECRET</code></TableCell>
              <TableCell><T>Yes*</T></TableCell>
              <TableCell className="text-sm text-text-secondary"><T><code>AZURE_CLIENT_SECRET</code> is also supported</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>NEXT_PUBLIC_URL</code></TableCell>
              <TableCell><T>Yes</T></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Public app URL</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Mode-Specific Variables</T>
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Mode</T></TableHeader>
              <TableHeader><T>Required Variables</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Supabase DB</T></TableCell>
              <TableCell>
                <code>NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{" "}
                <code>SUPABASE_SERVICE_ROLE_KEY</code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>SQLite DB</T></TableCell>
              <TableCell>
                <T><code>PACKAGER_API_KEY</code> (with local packager), optional{" "}
                <code>DATABASE_PATH</code></T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>GitHub Packager</T></TableCell>
              <TableCell>
                <T><code>GITHUB_PAT</code>, <code>GITHUB_OWNER</code>,{" "}
                <code>GITHUB_WORKFLOWS_REPO</code>, optional{" "}
                <code>GITHUB_REPO</code>, <code>GITHUB_REF</code>,{" "}
                <code>GITHUB_WORKFLOW_FILE</code>, <code>CALLBACK_SECRET</code></T>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Local Packager</T></TableCell>
              <TableCell>
                <T><code>PACKAGER_MODE=local</code> plus shared{" "}
                <code>PACKAGER_API_KEY</code> strategy</T>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Packager Service Variables</T>
        </h2>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader><T>Variable</T></TableHeader>
              <TableHeader><T>Use</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell><code>AZURE_CLIENT_ID</code> / <code>AZURE_CLIENT_SECRET</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Required for Graph and Intune operations</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>INTUNEGET_API_URL</code> + <code>PACKAGER_API_KEY</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>API mode (recommended for sqlite web mode)</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_ROLE_KEY</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Supabase mode</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell><code>POLL_INTERVAL</code>, <code>STALE_JOB_TIMEOUT</code></TableCell>
              <TableCell className="text-sm text-text-secondary"><T>Polling and stale-claim behavior</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      <section>
        <Callout type="tip" title="Validation Order">
          <p>
            <T>Confirm database mode first, then packager mode. Most setup issues
            come from mixing sqlite/supabase variables or missing packager auth
            key alignment.</T>
          </p>
        </Callout>
      </section>
    </div>
  );
}
