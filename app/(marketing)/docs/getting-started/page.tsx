import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
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
  alternates: {
    canonical: "https://intuneget.com/docs/getting-started",
  },
  openGraph: {
    title: "Getting Started | IntuneGet Docs",
    description:
      "Complete step-by-step guide to self-hosting IntuneGet. Deploy your own Intune app deployment solution in about 2 hours.",
  },
};

export default function GettingStartedPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Getting Started</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>This guide will walk you through deploying your own IntuneGet instance
          from scratch. Follow each step in order for the smoothest experience.</T>
        </p>
      </div>

      {/* Prerequisites */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Prerequisites Checklist</T>
        </h2>
        <p className="text-text-secondary mb-6">
          <T>Before starting, make sure you have accounts for these services:</T>
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
              className="flex items-center gap-3 p-3 rounded-lg border border-overlay/10 bg-bg-elevated"
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
                    <T>{item.name}</T>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <span className="font-medium text-text-primary"><T>{item.name}</T></span>
                )}
                <span className="text-sm text-text-muted ml-2"><T>{item.note}</T></span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Secrets Reference Table */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Complete Secrets Reference</T>
        </h2>
        <p className="text-text-secondary mb-6">
          <T>You will need to configure these environment variables. Reference this
          table as you work through the setup:</T>
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader><T>Variable</T></TableHeader>
                <TableHeader><T>Where to Get It</T></TableHeader>
                <TableHeader><T>Where to Use It</T></TableHeader>
                <TableHeader><T>Example</T></TableHeader>
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
                  <T>Set to &quot;sqlite&quot;</T>
                </TableCell>
                <TableCell className="text-sm"><T>.env.local, Docker</T></TableCell>
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
                  <T>Path to SQLite file</T>
                </TableCell>
                <TableCell className="text-sm"><T>.env.local, Docker</T></TableCell>
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
                  <T>Set to &quot;local&quot;</T>
                </TableCell>
                <TableCell className="text-sm"><T>.env.local, Docker</T></TableCell>
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
                  <T>Generate random string</T>
                </TableCell>
                <TableCell className="text-sm"><T>.env.local, Docker, Packager</T></TableCell>
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
                  <T>Azure Portal &gt; App Registration &gt; Overview</T>
                </TableCell>
                <TableCell className="text-sm">
                  <T>.env.local, Docker, Packager</T>
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
                  <T>Azure Portal &gt; App Registration &gt; Certificates & secrets</T>
                </TableCell>
                <TableCell className="text-sm">
                  <T>.env.local, Docker, Packager</T>
                </TableCell>
                <TableCell>
                  <code className="text-xs text-text-muted">Abc123~...</code>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <code className="text-accent-cyan text-xs">NEXT_PUBLIC_URL</code>
                </TableCell>
                <TableCell className="text-sm"><T>Your deployment URL</T></TableCell>
                <TableCell className="text-sm"><T>.env.local, Docker</T></TableCell>
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
            <T>Run this command in your terminal to generate a secure random API key:</T>
          </p>
          <CodeBlock language="bash">openssl rand -hex 32</CodeBlock>
        </Callout>
      </section>

      {/* Setup Steps */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6"><T>Setup Steps</T></h2>

        <Steps>
          <StepIndicator step={1} title="Set Up Entra ID App Registration">
            <p>
              <T>Create a multi-tenant app registration in Microsoft Entra ID to enable
              authentication and Intune access.</T>
            </p>
            <ol className="list-decimal list-inside mt-4 space-y-2 text-text-secondary">
              <li>
                <T>Go to{" "}
                <a
                  href="https://portal.azure.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-cyan hover:underline"
                >
                  Azure Portal
                </a>{" "}
                &gt; Microsoft Entra ID &gt; App registrations</T>
              </li>
              <li><T>Click &quot;New registration&quot;</T></li>
              <li>
                <T>Select &quot;Accounts in any organizational directory
                (Multitenant)&quot;</T>
              </li>
              <li><T>Add a SPA redirect URI for your app</T></li>
              <li><T>Configure API permissions and create a client secret</T></li>
            </ol>
            <div className="mt-4">
              <Link
                href="/docs/azure-setup"
                className="inline-flex items-center gap-1 text-sm text-accent-cyan hover:underline"
              >
                <T>Detailed Entra ID setup guide</T>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepIndicator>

          <StepIndicator step={2} title="Deploy with Docker">
            <p>
              <T>Deploy your IntuneGet instance using Docker with the embedded SQLite database.</T>
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
                <T>Detailed Docker deployment guide</T>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepIndicator>

          <StepIndicator step={3} title="Set Up the Local Packager">
            <p>
              <T>Install the packager service on a Windows machine to handle app packaging.</T>
            </p>
            <ol className="list-decimal list-inside mt-4 space-y-2 text-text-secondary">
              <li><T>On your Windows machine, install Node.js 18+</T></li>
              <li><T>Install the packager globally: <code className="text-accent-cyan">npm install -g @ugurkocde/intuneget-packager</code></T></li>
              <li><T>Set environment variables:</T></li>
            </ol>
            <CodeBlock language="bash" filename="Environment Variables (Windows)">
{`set INTUNEGET_API_URL=http://your-docker-host:3000
set PACKAGER_API_KEY=<same-key-as-web-app>
set AZURE_CLIENT_ID=<from-azure>
set AZURE_CLIENT_SECRET=<from-azure>`}
            </CodeBlock>
            <p className="mt-4 text-text-secondary">
              <T>Start the packager: <code className="text-accent-cyan">intuneget-packager</code></T>
            </p>
          </StepIndicator>

          <StepIndicator step={4} title="Verify Your Deployment" isLast>
            <p>
              <T>Test that everything is working correctly:</T>
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
                  <span><T>{item}</T></span>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Link
                href="/docs/troubleshooting"
                className="inline-flex items-center gap-1 text-sm text-accent-cyan hover:underline"
              >
                <T>Something not working? Check troubleshooting</T>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </StepIndicator>
        </Steps>
      </section>

      {/* Update Redirect URIs */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Final Configuration</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>After deployment, update your Entra ID app registration with your
          production URL:</T>
        </p>
        <ol className="list-decimal list-inside space-y-2 text-text-secondary">
          <li><T>Go to Azure Portal &gt; Your App Registration &gt; Authentication</T></li>
          <li>
            <T>Add your production URL as a SPA redirect URI (e.g.,
            https://your-app.vercel.app)</T>
          </li>
          <li><T>Click Save</T></li>
        </ol>

        <Callout type="warning" title="Important">
          <p>
            <T>Make sure NEXT_PUBLIC_URL in your environment matches your actual
            deployment URL exactly, including https:// and no trailing slash.</T>
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
            <T>Local Packager Details</T>
          </h2>
        </div>
        <p className="text-text-secondary mb-6">
          <T>The local packager is a Windows service that polls the web app for packaging
          jobs, creates .intunewin packages using Microsoft&apos;s IntuneWinAppUtil, and
          uploads them directly to Intune.</T>
        </p>

        <Callout type="info" title="Benefits of Local Packager">
          <ul className="space-y-1 text-sm">
            <li><T>- Zero external dependencies (no GitHub Actions needed)</T></li>
            <li><T>- Works in air-gapped or restricted network environments</T></li>
            <li><T>- Full data sovereignty - nothing leaves your network</T></li>
            <li><T>- Simple API key authentication</T></li>
          </ul>
        </Callout>

        <div className="mt-6 space-y-6">
          <div>
            <h3 className="text-lg font-medium text-text-primary mb-3 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-accent-cyan" />
              <T>Requirements</T>
            </h3>
            <ul className="list-disc list-inside space-y-2 text-text-secondary">
              <li><T>Windows 10/11 or Windows Server 2016+</T></li>
              <li><T>Node.js 18 or higher</T></li>
              <li><T>Network access to the web app and Microsoft Graph API</T></li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-medium text-text-primary mb-3"><T>Running as a Service</T></h3>
            <p className="text-text-secondary mb-3">
              <T>For production use, consider running the packager as a Windows service:</T>
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
            <T>View package on npm</T>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-overlay/10 bg-bg-elevated p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-4">
          <T>Congratulations!</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Your IntuneGet instance is now running. Here are some next steps:</T>
        </p>
        <ul className="space-y-2 text-text-secondary">
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            <T>Share the admin consent link with your Global Administrator</T>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            <T>Deploy your first test application to verify the pipeline works</T>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            <T>Configure{" "}
            <Link href="/docs/unmanaged-apps" className="text-accent-cyan hover:underline">
              assignment intents
            </Link>{" "}
            (Required, Available, Uninstall, or Update Only) when adding apps
            to your cart</T>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            <T>Set up a git remote to pull updates from the upstream repository</T>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-cyan">-</span>
            <T>Consider setting up analytics (Plausible) for usage insights</T>
          </li>
        </ul>
      </section>
    </div>
  );
}
