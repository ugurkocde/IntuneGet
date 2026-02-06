import { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle,
  ExternalLink,
  ArrowRight,
  Terminal,
  Server,
} from "lucide-react";
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
  title: "Getting Started | IntuneGet Docs",
  description:
    "Complete step-by-step guide to self-hosting IntuneGet. Deploy your own Intune app deployment solution in about 2 hours.",
};

export default function GettingStartedPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Getting Started
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          This guide will walk you through deploying your own IntuneGet instance
          from scratch. Follow each step in order for the smoothest experience.
        </p>
      </div>

      {/* Prerequisites */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Prerequisites Checklist
        </h2>
        <p className="text-text-secondary mb-6">
          Before starting, make sure you have accounts for these services:
        </p>

        <div className="space-y-3">
          {[
            {
              name: "Microsoft Azure Access",
              url: "https://portal.azure.com",
              note: "To create Entra ID app registrations",
            },
            {
              name: "Docker",
              url: "https://docker.com",
              note: "For running the web application",
            },
            {
              name: "Windows Machine",
              url: "",
              note: "For running the local packager",
            },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-3 p-3 rounded-lg border border-black/10 bg-white"
            >
              <div className="h-5 w-5 rounded-full border-2 border-accent-cyan/50 flex items-center justify-center">
                <div className="h-2 w-2 rounded-full bg-accent-cyan" />
              </div>
              <div className="flex-1">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-text-primary hover:text-accent-cyan transition-colors inline-flex items-center gap-1"
                  >
                    {item.name}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="font-medium text-text-primary">{item.name}</span>
                )}
                <span className="text-sm text-text-muted ml-2">{item.note}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Secrets Reference Table */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Complete Secrets Reference
        </h2>
        <p className="text-text-secondary mb-6">
          You will need to configure these environment variables. Reference this
          table as you work through the setup:
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Variable</TableHeader>
                <TableHeader>Where to Get It</TableHeader>
                <TableHeader>Where to Use It</TableHeader>
                <TableHeader>Example</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">
                    DATABASE_MODE
                  </code>
                </TableCell>
                <TableCell className="text-sm">
                  Set to &quot;sqlite&quot;
                </TableCell>
                <TableCell className="text-sm">.env.local, Docker</TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">sqlite</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">
                    DATABASE_PATH
                  </code>
                </TableCell>
                <TableCell className="text-sm">
                  Path to SQLite file
                </TableCell>
                <TableCell className="text-sm">.env.local, Docker</TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">/data/intuneget.db</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">
                    PACKAGER_MODE
                  </code>
                </TableCell>
                <TableCell className="text-sm">
                  Set to &quot;local&quot;
                </TableCell>
                <TableCell className="text-sm">.env.local, Docker</TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">local</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">
                    PACKAGER_API_KEY
                  </code>
                </TableCell>
                <TableCell className="text-sm">
                  Generate random string
                </TableCell>
                <TableCell className="text-sm">.env.local, Docker, Packager</TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">random-32-char...</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">
                    NEXT_PUBLIC_AZURE_AD_CLIENT_ID
                  </code>
                </TableCell>
                <TableCell className="text-sm">
                  Azure Portal &gt; App Registration &gt; Overview
                </TableCell>
                <TableCell className="text-sm">
                  .env.local, Docker, Packager
                </TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">12345678-1234-...</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">
                    AZURE_CLIENT_SECRET
                  </code>
                </TableCell>
                <TableCell className="text-sm">
                  Azure Portal &gt; App Registration &gt; Certificates & secrets
                </TableCell>
                <TableCell className="text-sm">
                  .env.local, Docker, Packager
                </TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">Abc123~...</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">NEXT_PUBLIC_URL</code>
                </TableCell>
                <TableCell className="text-sm">Your deployment URL</TableCell>
                <TableCell className="text-sm">.env.local, Docker</TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">
                    http://localhost:3000
                  </code>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <Callout type="tip" title="Generate a Secure API Key">
          <p>
            Run this command in your terminal to generate a secure random API key:
          </p>
          <CodeBlock language="bash">openssl rand -hex 32</CodeBlock>
        </Callout>
      </section>

      {/* Setup Steps */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">Setup Steps</h2>

        <Steps>
          <StepIndicator step={1} title="Set Up Entra ID App Registration">
            <p>
              Create a multi-tenant app registration in Microsoft Entra ID to enable
              authentication and Intune access.
            </p>
            <ol className="list-decimal list-inside mt-4 space-y-2 text-text-secondary">
              <li>
                Go to{" "}
                <a
                  href="https://portal.azure.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  Azure Portal
                </a>{" "}
                &gt; Microsoft Entra ID &gt; App registrations
              </li>
              <li>Click &quot;New registration&quot;</li>
              <li>
                Select &quot;Accounts in any organizational directory
                (Multitenant)&quot;
              </li>
              <li>Add a SPA redirect URI for your app</li>
              <li>Configure API permissions and create a client secret</li>
            </ol>
            <div className="mt-4">
              <Link
                href="/docs/azure-setup"
                className="inline-flex items-center gap-1 text-sm text-accent-cyan hover:underline"
              >
                Detailed Entra ID setup guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepIndicator>

          <StepIndicator step={2} title="Deploy with Docker">
            <p>
              Deploy your IntuneGet instance using Docker with the embedded SQLite database.
            </p>

            <CodeBlock language="bash" filename="Terminal">
{`# Clone the repository
git clone https://github.com/ugurkocde/IntuneGet.git
cd IntuneGet

# Copy and configure environment
cp .env.example .env.local

# Edit .env.local with these values:
# DATABASE_MODE=sqlite
# DATABASE_PATH=/data/intuneget.db
# PACKAGER_MODE=local
# PACKAGER_API_KEY=<your-generated-api-key>
# NEXT_PUBLIC_AZURE_AD_CLIENT_ID=<from-azure>
# AZURE_CLIENT_SECRET=<from-azure>
# NEXT_PUBLIC_URL=http://localhost:3000

# Start with Docker Compose
docker-compose up -d`}
            </CodeBlock>
            <div className="mt-4">
              <Link
                href="/docs/docker"
                className="inline-flex items-center gap-1 text-sm text-accent-cyan hover:underline"
              >
                Detailed Docker deployment guide
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepIndicator>

          <StepIndicator step={3} title="Set Up the Local Packager">
            <p>
              Install the packager service on a Windows machine to handle app packaging.
            </p>
            <ol className="list-decimal list-inside mt-4 space-y-2 text-text-secondary">
              <li>On your Windows machine, install Node.js 18+</li>
              <li>Install the packager globally: <code className="text-accent-cyan">npm install -g @ugurkocde/intuneget-packager</code></li>
              <li>Set environment variables:</li>
            </ol>
            <CodeBlock language="bash" filename="Environment Variables (Windows)">
{`set INTUNEGET_API_URL=http://your-docker-host:3000
set PACKAGER_API_KEY=<same-key-as-web-app>
set AZURE_CLIENT_ID=<from-azure>
set AZURE_CLIENT_SECRET=<from-azure>`}
            </CodeBlock>
            <p className="mt-4 text-text-secondary">
              Start the packager: <code className="text-accent-cyan">intuneget-packager</code>
            </p>
          </StepIndicator>

          <StepIndicator step={4} title="Verify Your Deployment" isLast>
            <p>
              Test that everything is working correctly:
            </p>
            <div className="mt-4 space-y-3">
              {[
                "Visit your deployment URL - homepage should load",
                "Check the health endpoint: /api/health",
                "Try signing in with a Microsoft work account",
                "Test the app search functionality",
                "Try deploying a test app (e.g., Notepad++)",
              ].map((item, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 text-text-secondary"
                >
                  <CheckCircle className="h-5 w-5 text-status-success flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Link
                href="/docs/troubleshooting"
                className="inline-flex items-center gap-1 text-sm text-accent-cyan hover:underline"
              >
                Something not working? Check troubleshooting
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepIndicator>
        </Steps>
      </section>

      {/* Update Redirect URIs */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Final Configuration
        </h2>
        <p className="text-text-secondary mb-4">
          After deployment, update your Entra ID app registration with your
          production URL:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary">
          <li>Go to Azure Portal &gt; Your App Registration &gt; Authentication</li>
          <li>
            Add your production URL as a SPA redirect URI (e.g.,
            https://your-app.vercel.app)
          </li>
          <li>Click Save</li>
        </ol>

        <Callout type="warning" title="Important">
          <p>
            Make sure NEXT_PUBLIC_URL in your environment matches your actual
            deployment URL exactly, including https:// and no trailing slash.
          </p>
        </Callout>
      </section>

      {/* Local Packager Details */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-accent-cyan/10 border border-accent-cyan/20">
            <Server className="h-5 w-5 text-accent-cyan" />
          </div>
          <h2 className="text-2xl font-semibold text-text-primary">
            Local Packager Details
          </h2>
        </div>
        <p className="text-text-secondary mb-6">
          The local packager is a Windows service that polls the web app for packaging
          jobs, creates .intunewin packages using Microsoft&apos;s IntuneWinAppUtil, and
          uploads them directly to Intune.
        </p>

        <Callout type="info" title="Benefits of Local Packager">
          <ul className="space-y-1 text-sm">
            <li>- Zero external dependencies (no GitHub Actions needed)</li>
            <li>- Works in air-gapped or restricted network environments</li>
            <li>- Full data sovereignty - nothing leaves your network</li>
            <li>- Simple API key authentication</li>
          </ul>
        </Callout>

        <div className="mt-6 space-y-6">
          <div>
            <h3 className="text-lg font-medium text-text-primary mb-3 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-accent-cyan" />
              Requirements
            </h3>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li>Windows 10/11 or Windows Server 2016+</li>
              <li>Node.js 18 or higher</li>
              <li>Network access to the web app and Microsoft Graph API</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-text-primary mb-3">Running as a Service</h3>
            <p className="text-text-secondary mb-3">
              For production use, consider running the packager as a Windows service:
            </p>
            <CodeBlock language="bash" filename="PowerShell (as Administrator)">
{`# Install NSSM (Non-Sucking Service Manager)
choco install nssm

# Create a service
nssm install IntuneGetPackager "C:\\Program Files\\nodejs\\node.exe"
nssm set IntuneGetPackager AppParameters "C:\\Users\\<user>\\AppData\\Roaming\\npm\\node_modules\\@ugurkocde\\intuneget-packager\\dist\\index.js"
nssm set IntuneGetPackager AppDirectory "C:\\"
nssm set IntuneGetPackager AppEnvironmentExtra "INTUNEGET_API_URL=http://your-server:3000" "PACKAGER_API_KEY=xxx" "AZURE_CLIENT_ID=xxx" "AZURE_CLIENT_SECRET=xxx"

# Start the service
nssm start IntuneGetPackager`}
            </CodeBlock>
          </div>
        </div>

        <div className="mt-6">
          <a
            href="https://www.npmjs.com/package/@ugurkocde/intuneget-packager"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-accent-cyan hover:underline"
          >
            View package on npm
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-black/10 bg-white p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-4">
          Congratulations!
        </h2>
        <p className="text-text-secondary mb-4">
          Your IntuneGet instance is now running. Here are some next steps:
        </p>
        <ul className="space-y-2 text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            Share the admin consent link with your Global Administrator
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            Deploy your first test application to verify the pipeline works
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            Set up a git remote to pull updates from the upstream repository
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            Consider setting up analytics (Plausible) for usage insights
          </li>
        </ul>
      </section>
    </div>
  );
}
