import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, Github, AlertCircle, DollarSign, Server } from "lucide-react";
import {
  Callout,
  CodeBlock,
  Steps,
  StepIndicator,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Collapsible,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "GitHub Setup | IntuneGet Docs",
  description:
    "Optional GitHub Actions pipeline for IntuneGet app packaging. The local packager is now the recommended approach.",
};

export default function GitHubSetupPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          GitHub Setup
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          Optional GitHub Actions pipeline for cloud-based packaging. The local
          packager is now the recommended approach for most deployments.
        </p>
      </div>

      {/* Local Packager Notice */}
      <section>
        <Callout type="info" title="Local Packager Recommended">
          <p>
            Starting with v0.5, IntuneGet includes a <strong>local packager service</strong>{" "}
            that runs on a Windows machine and handles all app packaging locally.
            This eliminates the need for GitHub Actions and provides faster
            packaging with no usage limits. See the{" "}
            <Link href="/docs/getting-started" className="text-accent-cyan hover:underline">
              Getting Started guide
            </Link>{" "}
            for local packager setup.
          </p>
        </Callout>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-status-success/20 bg-status-success/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Server className="h-5 w-5 text-status-success" />
              <h3 className="font-semibold text-text-primary">Local Packager</h3>
            </div>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>No usage limits or costs</li>
              <li>Faster packaging (no cloud roundtrip)</li>
              <li>Simple API key authentication</li>
              <li>Works entirely on your infrastructure</li>
            </ul>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-center gap-2 mb-3">
              <Github className="h-5 w-5 text-text-secondary" />
              <h3 className="font-semibold text-text-primary">GitHub Actions</h3>
            </div>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>2,000 free minutes/month (private repos)</li>
              <li>No local Windows machine required</li>
              <li>Good for testing or low-volume use</li>
              <li>Requires PAT and repository setup</li>
            </ul>
          </div>
        </div>
      </section>

      {/* GitHub Actions Setup (Condensed) */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          GitHub Actions Setup (Optional)
        </h2>
        <p className="text-text-secondary mb-6">
          If you prefer GitHub Actions for packaging, or want it as a fallback,
          follow these steps:
        </p>

        <Steps>
          <StepIndicator step={1} title="Fork the Repository">
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>
                Go to{" "}
                <a
                  href="https://github.com/ugurkocde/IntuneGet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline inline-flex items-center gap-1"
                >
                  github.com/ugurkocde/IntuneGet
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
              <li>
                Click <strong>Fork</strong> in the top right
              </li>
              <li>Select your account/organization</li>
            </ol>
          </StepIndicator>

          <StepIndicator step={2} title="Configure Repository Secrets">
            <p className="mb-4">
              Navigate to your fork: <strong>Settings</strong> &gt;{" "}
              <strong>Secrets and variables</strong> &gt; <strong>Actions</strong>
            </p>

            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Secret Name</TableHeader>
                  <TableHeader>Description</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <code className="text-accent-cyan text-xs">AZURE_CLIENT_ID</code>
                  </TableCell>
                  <TableCell className="text-sm">Entra ID Application ID</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-accent-cyan text-xs">AZURE_CLIENT_SECRET</code>
                  </TableCell>
                  <TableCell className="text-sm">Entra ID Client Secret</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-accent-cyan text-xs">CALLBACK_SECRET</code>
                  </TableCell>
                  <TableCell className="text-sm">
                    Webhook verification (must match your .env)
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </StepIndicator>

          <StepIndicator step={3} title="Enable Actions & Create PAT">
            <ol className="list-decimal list-inside space-y-2 text-text-secondary">
              <li>Go to the <strong>Actions</strong> tab and enable workflows</li>
              <li>
                Create a PAT at{" "}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline inline-flex items-center gap-1"
                >
                  github.com/settings/tokens
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
              <li>
                Required scopes: <code className="text-accent-cyan">repo</code> +{" "}
                <code className="text-accent-cyan">workflow</code>
              </li>
            </ol>
          </StepIndicator>

          <StepIndicator step={4} title="Update Environment" isLast>
            <CodeBlock language="bash" filename=".env.local">
{`GITHUB_OWNER=your-github-username
GITHUB_REPO=IntuneGet
GITHUB_PAT=ghp_your-personal-access-token
CALLBACK_SECRET=same-secret-as-in-github`}
            </CodeBlock>
          </StepIndicator>
        </Steps>
      </section>

      {/* Cost */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Cost Considerations
        </h2>

        <div className="rounded-lg border border-black/10 bg-white p-4 flex items-start gap-4">
          <DollarSign className="h-6 w-6 text-accent-cyan flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-semibold text-text-primary mb-2">GitHub Actions Usage</h3>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>
                <strong>Public repos:</strong> Free
              </li>
              <li>
                <strong>Private repos:</strong> 2,000 minutes/month free, then
                $0.008/minute for Windows runners
              </li>
            </ul>
            <p className="text-sm text-text-muted mt-3">
              Each packaging job typically takes 2-5 minutes. The local packager
              has no such limits.
            </p>
          </div>
        </div>
      </section>

      {/* Common Issues */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Common Issues
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Workflow not triggering
            </h3>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>Verify PAT has correct scopes (repo + workflow)</li>
              <li>Check workflow is enabled in the Actions tab</li>
              <li>Verify GITHUB_OWNER and GITHUB_REPO are correct</li>
            </ul>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Callback fails
            </h3>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>Verify CALLBACK_SECRET matches in both places</li>
              <li>Check NEXT_PUBLIC_URL is accessible from GitHub</li>
              <li>Review callback endpoint logs</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Next Steps</h2>
        <p className="text-text-secondary mb-4">
          Continue with Docker deployment to get your instance running.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/docs/docker"
            className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
          >
            Deploy with Docker
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/docs/getting-started"
            className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary"
          >
            Getting Started (Local Packager)
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
