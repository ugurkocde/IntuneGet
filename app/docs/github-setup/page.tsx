import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, Github, AlertCircle, DollarSign } from "lucide-react";
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
    "Configure GitHub Actions pipeline for IntuneGet app packaging. Set up automated Winget to Intune deployment.",
};

export default function GitHubSetupPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          GitHub Setup
        </h1>
        <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
          Configure the GitHub Actions packaging pipeline that downloads apps from
          Winget and uploads them to Intune.
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">Overview</h2>
        <p className="text-zinc-400 mb-4">
          IntuneGet uses GitHub Actions to:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>Download applications from Winget</li>
          <li>
            Package them as <code>.intunewin</code> files using IntuneWinAppUtil.exe
          </li>
          <li>Upload the packaged app to Microsoft Intune</li>
          <li>Report status back to the web application</li>
        </ol>

        <Callout type="info" title="Windows Runner Required">
          <p>
            The workflow runs on a <strong>Windows runner</strong> because
            IntuneWinAppUtil.exe is a Windows-only tool.
          </p>
        </Callout>
      </section>

      {/* Fork Setup */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-6">Fork Setup</h2>

        <Steps>
          <StepIndicator step={1} title="Fork the Repository">
            <ol className="list-decimal list-inside space-y-2 text-zinc-300">
              <li>
                Go to{" "}
                <a
                  href="https://github.com/ugurkocde/IntuneGet-Website"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline inline-flex items-center gap-1"
                >
                  github.com/ugurkocde/IntuneGet-Website
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
              <li>
                Click <strong>Fork</strong> in the top right
              </li>
              <li>Select your account/organization</li>
              <li>Wait for the fork to complete</li>
            </ol>
          </StepIndicator>

          <StepIndicator step={2} title="Configure Repository Secrets">
            <p className="mb-4">
              Navigate to your forked repository and add secrets:
            </p>
            <p className="text-zinc-300 mb-4">
              <strong>Settings</strong> &gt; <strong>Secrets and variables</strong>{" "}
              &gt; <strong>Actions</strong> &gt; <strong>New repository secret</strong>
            </p>

            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Secret Name</TableHeader>
                  <TableHeader>Description</TableHeader>
                  <TableHeader>How to Get</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>
                    <code className="text-accent-cyan text-xs">AZURE_CLIENT_ID</code>
                  </TableCell>
                  <TableCell>Azure AD Application ID</TableCell>
                  <TableCell className="text-sm">
                    From Azure AD app registration
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-accent-cyan text-xs">
                      AZURE_CLIENT_SECRET
                    </code>
                  </TableCell>
                  <TableCell>Azure AD Client Secret</TableCell>
                  <TableCell className="text-sm">
                    From Azure AD app registration
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>
                    <code className="text-accent-cyan text-xs">CALLBACK_SECRET</code>
                  </TableCell>
                  <TableCell>Webhook verification secret</TableCell>
                  <TableCell className="text-sm">
                    Generate with <code>openssl rand -hex 16</code>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <Callout type="warning" title="Secret Must Match">
              <p>
                The CALLBACK_SECRET must be the same value in both GitHub Secrets
                and your web app&apos;s environment variables.
              </p>
            </Callout>
          </StepIndicator>

          <StepIndicator step={3} title="Enable GitHub Actions">
            <p className="mb-4">
              GitHub disables workflows in forks by default. Enable them:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-zinc-300">
              <li>
                Go to the <strong>Actions</strong> tab in your fork
              </li>
              <li>
                Click{" "}
                <strong>
                  I understand my workflows, go ahead and enable them
                </strong>
              </li>
            </ol>
          </StepIndicator>

          <StepIndicator step={4} title="Create Personal Access Token" isLast>
            <p className="mb-4">
              Create a PAT that allows IntuneGet to trigger workflows:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-zinc-300">
              <li>
                Go to{" "}
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
                Click <strong>Generate new token (classic)</strong>
              </li>
              <li>
                Set a descriptive name: <code>IntuneGet Pipeline</code>
              </li>
              <li>
                Select scopes:
                <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-zinc-400">
                  <li>
                    <code className="text-accent-cyan">repo</code> (Full control of
                    private repositories)
                  </li>
                  <li>
                    <code className="text-accent-cyan">workflow</code> (Update
                    GitHub Action workflows)
                  </li>
                </ul>
              </li>
              <li>
                Click <strong>Generate token</strong>
              </li>
              <li>Copy the token immediately</li>
            </ol>

            <Collapsible title="Using Fine-Grained Tokens (Alternative)">
              <p className="text-sm text-zinc-400 mb-3">
                For enhanced security, use a fine-grained token:
              </p>
              <ul className="list-disc list-inside space-y-2 text-zinc-300">
                <li>
                  <strong>Repository access:</strong> Select your fork only
                </li>
                <li>
                  <strong>Permissions:</strong>
                  <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-zinc-400">
                    <li>Actions: Read and write</li>
                    <li>Contents: Read</li>
                  </ul>
                </li>
              </ul>
            </Collapsible>
          </StepIndicator>
        </Steps>
      </section>

      {/* Update Environment */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Update Your Environment
        </h2>
        <p className="text-zinc-400 mb-4">
          In your IntuneGet deployment, update these environment variables to point
          to your fork:
        </p>

        <CodeBlock language="bash" filename=".env.local">
{`GITHUB_OWNER=your-github-username
GITHUB_REPO=IntuneGet-Website
GITHUB_PAT=ghp_your-personal-access-token
CALLBACK_SECRET=same-secret-as-in-github`}
        </CodeBlock>
      </section>

      {/* How It Works */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          How the Pipeline Works
        </h2>

        <div className="rounded-lg border border-white/10 bg-bg-surface p-6 mb-6">
          <h3 className="font-semibold text-white mb-4">Workflow Inputs</h3>
          <p className="text-sm text-zinc-400 mb-3">
            When triggered, the workflow receives:
          </p>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Input</TableHeader>
                <TableHeader>Description</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">app_id</code>
                </TableCell>
                <TableCell>Winget package identifier</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">deployment_id</code>
                </TableCell>
                <TableCell>Unique deployment tracking ID</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">tenant_id</code>
                </TableCell>
                <TableCell>Target Microsoft 365 tenant</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">callback_url</code>
                </TableCell>
                <TableCell>URL to report status back</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="rounded-lg border border-white/10 bg-bg-surface p-6">
          <h3 className="font-semibold text-white mb-4">Workflow Steps</h3>
          <ol className="list-decimal list-inside space-y-3 text-zinc-300">
            <li>
              <strong>Download App:</strong> Uses Winget to download the installer
            </li>
            <li>
              <strong>Package:</strong> Runs IntuneWinAppUtil.exe to create
              .intunewin file
            </li>
            <li>
              <strong>Authenticate:</strong> Gets access token for Intune API
            </li>
            <li>
              <strong>Upload:</strong> Uploads package to customer&apos;s Intune
              tenant
            </li>
            <li>
              <strong>Report:</strong> Calls callback URL with status
            </li>
          </ol>
        </div>
      </section>

      {/* Testing */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Testing the Pipeline
        </h2>
        <p className="text-zinc-400 mb-4">
          Test the pipeline manually before integrating:
        </p>

        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>
            Go to <strong>Actions</strong> in your fork
          </li>
          <li>
            Select the <strong>Package Intunewin</strong> workflow
          </li>
          <li>
            Click <strong>Run workflow</strong>
          </li>
          <li>
            Fill in test values:
            <ul className="list-disc list-inside ml-6 mt-2 space-y-1 text-zinc-400">
              <li>
                <code>app_id:</code> Microsoft.VisualStudioCode
              </li>
              <li>
                <code>deployment_id:</code> test-123
              </li>
              <li>
                <code>tenant_id:</code> Your test tenant
              </li>
              <li>
                <code>callback_url:</code> Your deployment URL + /api/callback
              </li>
            </ul>
          </li>
          <li>
            Click <strong>Run workflow</strong>
          </li>
        </ol>
      </section>

      {/* Cost */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Cost Considerations
        </h2>

        <div className="rounded-lg border border-white/10 bg-bg-surface p-4 flex items-start gap-4">
          <DollarSign className="h-6 w-6 text-accent-cyan flex-shrink-0 mt-1" />
          <div>
            <h3 className="font-semibold text-white mb-2">GitHub Actions Usage</h3>
            <ul className="list-disc list-inside space-y-2 text-zinc-300">
              <li>
                <strong>Public repos:</strong> Free
              </li>
              <li>
                <strong>Private repos:</strong> 2,000 minutes/month free, then
                $0.008/minute for Windows runners
              </li>
            </ul>
            <p className="text-sm text-zinc-500 mt-3">
              Each packaging job typically takes 2-5 minutes.
            </p>
          </div>
        </div>
      </section>

      {/* Self-Hosted Runner */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Self-Hosted Runner (Optional)
        </h2>
        <p className="text-zinc-400 mb-4">
          For enterprises wanting to use their own infrastructure:
        </p>

        <Collapsible title="Requirements">
          <ul className="list-disc list-inside space-y-2 text-zinc-300">
            <li>Windows 10/11 or Windows Server 2019+</li>
            <li>PowerShell 5.1+</li>
            <li>At least 4GB RAM</li>
            <li>20GB+ free disk space</li>
            <li>Internet access</li>
          </ul>
        </Collapsible>

        <Collapsible title="Setup Instructions">
          <ol className="list-decimal list-inside space-y-2 text-zinc-300">
            <li>
              In your repository, go to <strong>Settings</strong> &gt;{" "}
              <strong>Actions</strong> &gt; <strong>Runners</strong>
            </li>
            <li>
              Click <strong>New self-hosted runner</strong>
            </li>
            <li>
              Select <strong>Windows</strong> and follow the instructions
            </li>
          </ol>
          <p className="text-sm text-zinc-400 mt-4">
            Update the workflow to use your runner:
          </p>
          <CodeBlock language="yaml">
{`jobs:
  package:
    runs-on: self-hosted  # Changed from windows-latest`}
          </CodeBlock>
        </Collapsible>
      </section>

      {/* Troubleshooting */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Common Issues
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Workflow not triggering
            </h3>
            <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
              <li>Verify PAT has correct scopes (repo + workflow)</li>
              <li>Check workflow is enabled in the Actions tab</li>
              <li>Verify GITHUB_OWNER and GITHUB_REPO are correct</li>
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              IntuneWinAppUtil fails
            </h3>
            <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
              <li>Check app ID is valid in Winget</li>
              <li>Verify the app has a supported installer type</li>
              <li>Check runner has enough disk space</li>
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Callback fails
            </h3>
            <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
              <li>Verify CALLBACK_SECRET matches in both places</li>
              <li>Check NEXT_PUBLIC_URL is accessible from GitHub</li>
              <li>Review callback endpoint logs</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-white mb-3">Next Steps</h2>
        <p className="text-zinc-400 mb-4">
          GitHub pipeline is configured! Now choose your deployment method.
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
            href="/docs/getting-started#deploy-the-application"
            className="inline-flex items-center gap-2 text-zinc-400 hover:text-white"
          >
            Deploy to Vercel
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
