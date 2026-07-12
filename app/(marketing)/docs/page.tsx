import Link from "next/link";
import { Metadata } from "next";
import { T } from "gt-next";
import {
  Rocket,
  Cloud,
  Database,
  Container,
  HelpCircle,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Shield,
  Server,
  SearchX,
  Building2,
  Settings,
  FileText,
  ClipboardList,
  RefreshCw,
  Package,
  SlidersHorizontal,
} from "lucide-react";
import { Github } from "@/components/icons/brand-icons";
import {
  Callout,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "Documentation | IntuneGet",
  description:
    "Learn how to self-host IntuneGet - comprehensive documentation for deploying your own Intune app deployment solution.",
  alternates: {
    canonical: "https://intuneget.com/docs",
  },
  openGraph: {
    title: "Documentation | IntuneGet",
    description:
      "Learn how to self-host IntuneGet - comprehensive documentation for deploying your own Intune app deployment solution.",
  },
};

const quickLinks = [
  {
    title: "Getting Started",
    href: "/docs/getting-started",
    icon: Rocket,
    description: "Complete setup walkthrough from zero to deployment",
  },
  {
    title: "Entra ID Setup",
    href: "/docs/azure-setup",
    icon: Cloud,
    description: "Configure Microsoft Entra ID app registration",
  },
  {
    title: "Database Setup",
    href: "/docs/database-setup",
    icon: Database,
    description: "SQLite configuration and backups",
  },
  {
    title: "GitHub Setup",
    href: "/docs/github-setup",
    icon: Github,
    description: "Optional: GitHub Actions for cloud packaging",
  },
  {
    title: "Docker",
    href: "/docs/docker",
    icon: Container,
    description: "Deploy with Docker and Docker Compose",
  },
  {
    title: "Environment Reference",
    href: "/docs/environment-reference",
    icon: SlidersHorizontal,
    description: "Complete env vars for all deployment modes",
  },
  {
    title: "API Reference",
    href: "/docs/api-reference",
    icon: FileText,
    description: "Endpoint map by domain and auth model",
  },
  {
    title: "SCCM Migration",
    href: "/docs/sccm-migration",
    icon: ClipboardList,
    description: "Import SCCM, match to WinGet, and migrate",
  },
  {
    title: "Updates & Policies",
    href: "/docs/updates-policies",
    icon: RefreshCw,
    description: "Available updates, policy types, trigger flow",
  },
  {
    title: "Inventory/Reports/Uploads",
    href: "/docs/inventory-reports-uploads",
    icon: Package,
    description: "Operational dashboards and related APIs",
  },
  {
    title: "Unmanaged Apps",
    href: "/docs/unmanaged-apps",
    icon: SearchX,
    description: "Detect and manage discovered applications",
  },
  {
    title: "MSP Features",
    href: "/docs/msp",
    icon: Building2,
    description: "Multi-tenant management and batch deployments",
  },
  {
    title: "Settings & Webhooks",
    href: "/docs/settings",
    icon: Settings,
    description: "Notifications, exports, and data management",
  },
  {
    title: "Troubleshooting",
    href: "/docs/troubleshooting",
    icon: HelpCircle,
    description: "Common issues and FAQ",
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Self-Hosting Documentation</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>IntuneGet is 100% open source and designed to be self-hosted. This
          documentation will guide you through deploying your own instance,
          giving you full control over your data and infrastructure.</T>
        </p>
      </div>

      {/* What is IntuneGet */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>What is IntuneGet?</T>
        </h2>
        <p className="text-text-secondary leading-relaxed mb-4">
          <T>IntuneGet bridges the gap between Winget and Microsoft Intune. It
          automatically packages applications from the Winget repository and
          uploads them to your Intune environment, streamlining app deployment
          with just a few clicks.</T>
        </p>
        <p className="text-text-secondary leading-relaxed">
          <T>The self-hosted version gives you complete control over your
          deployment pipeline, data storage, and authentication - perfect for
          organizations with specific security or compliance requirements.</T>
        </p>
      </section>

      {/* Hosted vs Self-Hosted */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Hosted vs Self-Hosted</T>
        </h2>
        <p className="text-text-secondary leading-relaxed mb-6">
          <T>Compare the two deployment options to decide which is right for you:</T>
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader className="w-1/3"><T>Feature</T></TableHeader>
              <TableHeader className="w-1/3"><T>Hosted (intuneget.com)</T></TableHeader>
              <TableHeader className="w-1/3"><T>Self-Hosted</T></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Setup Time</T></TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <Clock className="h-4 w-4" />
                  <T>Instant</T>
                </span>
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-warning">
                  <Clock className="h-4 w-4" />
                  <T>1-2 hours</T>
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Cost</T></TableCell>
              <TableCell><T>Free (hosted by maintainer)</T></TableCell>
              <TableCell><T>Free tier services available</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Data Control</T></TableCell>
              <TableCell><T>Shared infrastructure</T></TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <CheckCircle className="h-4 w-4" />
                  <T>Full control</T>
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Customization</T></TableCell>
              <TableCell><T>Limited</T></TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <CheckCircle className="h-4 w-4" />
                  <T>Unlimited</T>
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Maintenance</T></TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <CheckCircle className="h-4 w-4" />
                  <T>Automatic</T>
                </span>
              </TableCell>
              <TableCell><T>Self-managed</T></TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-text-primary"><T>Updates</T></TableCell>
              <TableCell><T>Automatic</T></TableCell>
              <TableCell><T>Manual (git pull)</T></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Is Self-Hosting Right for You */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Is Self-Hosting Right for You?</T>
        </h2>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Good fit */}
          <div className="rounded-lg border border-status-success/20 bg-status-success/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-status-success mb-4">
              <CheckCircle className="h-5 w-5" />
              <T>Self-hosting is great if you:</T>
            </h3>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                <T>Need full control over your data</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                <T>Have compliance requirements (data residency, etc.)</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                <T>Want to customize the application</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                <T>Are comfortable with basic DevOps tasks</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                <T>Have existing cloud infrastructure</T>
              </li>
            </ul>
          </div>

          {/* Not ideal */}
          <div className="rounded-lg border border-status-warning/20 bg-status-warning/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-status-warning mb-4">
              <XCircle className="h-5 w-5" />
              <T>Consider hosted if you:</T>
            </h3>
            <ul className="space-y-2 text-sm text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                <T>Want to get started immediately</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                <T>Prefer zero maintenance overhead</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                <T>Don&apos;t have specific data residency needs</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                <T>Are evaluating the tool for the first time</T>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                <T>Have limited technical resources</T>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Requirements</T></h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-accent-cyan/10 p-2">
                <Clock className="h-5 w-5 text-accent-cyan" />
              </div>
              <h3 className="font-semibold text-text-primary"><T>Time</T></h3>
            </div>
            <p className="text-sm text-text-secondary">
              <T>Initial setup takes 1-2 hours. Occasional updates may take 15-30
              minutes.</T>
            </p>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-accent-cyan/10 p-2">
                <DollarSign className="h-5 w-5 text-accent-cyan" />
              </div>
              <h3 className="font-semibold text-text-primary"><T>Cost</T></h3>
            </div>
            <p className="text-sm text-text-secondary">
              <T>Completely free. SQLite database included. Optional GitHub Actions
              (2000 min/month for private repos).</T>
            </p>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-accent-cyan/10 p-2">
                <Shield className="h-5 w-5 text-accent-cyan" />
              </div>
              <h3 className="font-semibold text-text-primary"><T>Access</T></h3>
            </div>
            <p className="text-sm text-text-secondary">
              <T>Entra ID permissions to create app registrations (admin access
              helpful but not required). The Unmanaged Apps feature requires the
              additional DeviceManagementManagedDevices.Read.All permission.</T>
            </p>
          </div>
        </div>

        <Callout type="info" title="Accounts You'll Need">
          <ul className="list-disc list-inside space-y-1">
            <li>
              <T><strong>Microsoft Azure</strong> - Access to create Entra ID app
              registrations</T>
            </li>
            <li>
              <T><strong>GitHub</strong> - Free account (optional, only if using GitHub Actions for packaging)</T>
            </li>
            <li>
              <T><strong>Hosting</strong> - Docker (recommended) or any Node.js host</T>
            </li>
          </ul>
        </Callout>
      </section>

      {/* Quick Links */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          <T>Documentation Sections</T>
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group rounded-lg border border-overlay/10 bg-bg-elevated p-5 transition-all duration-200 hover:border-accent-cyan/30 hover:bg-overlay/[0.04]"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-accent-cyan/10 p-2.5 transition-colors group-hover:bg-accent-cyan/20">
                    <Icon className="h-5 w-5 text-accent-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-text-primary group-hover:text-accent-cyan transition-colors">
                      <T>{link.title}</T>
                    </h3>
                    <p className="mt-1 text-sm text-text-muted">
                      <T>{link.description}</T>
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Architecture Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Architecture Overview</T>
        </h2>
        <p className="text-text-secondary leading-relaxed mb-6">
          <T>Self-hosted IntuneGet runs entirely on your infrastructure with zero external dependencies:</T>
        </p>

        <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4 sm:p-6 font-mono">
          <pre className="text-text-secondary overflow-x-auto text-[10px] sm:text-xs md:text-sm">
{`+----------------------------------+       +--------------------------------+
|         DOCKER CONTAINER         |       |      WINDOWS MACHINE           |
+----------------------------------+       +--------------------------------+
|  Next.js Web App                 |       |  Packager Service              |
|  - Embedded SQLite database      |       |  - Uses HTTP API only          |
|  - /api/packager/jobs endpoints  |<------|  - No database credentials     |
|  - Unmanaged apps detection      |       |  - Simple API key auth         |
|  - MSP multi-tenant management   |       |                                |
+----------------------------------+       +--------------------------------+
         |                                           |
         v                                           v
    /data/intuneget.db                        Microsoft Intune
    (SQLite file)                             (Upload packages)`}
          </pre>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="text-center p-4">
            <Server className="h-8 w-8 text-accent-cyan mx-auto mb-2" />
            <h4 className="font-medium text-text-primary mb-1"><T>Web Application</T></h4>
            <p className="text-xs text-text-muted">
              <T>Next.js app with embedded SQLite database</T>
            </p>
          </div>
          <div className="text-center p-4">
            <Container className="h-8 w-8 text-accent-cyan mx-auto mb-2" />
            <h4 className="font-medium text-text-primary mb-1"><T>Local Packager</T></h4>
            <p className="text-xs text-text-muted">
              <T>Windows service for .intunewin packaging</T>
            </p>
          </div>
          <div className="text-center p-4">
            <Database className="h-8 w-8 text-accent-cyan mx-auto mb-2" />
            <h4 className="font-medium text-text-primary mb-1"><T>SQLite Database</T></h4>
            <p className="text-xs text-text-muted">
              <T>Local file-based storage, easy backup</T>
            </p>
          </div>
        </div>
      </section>

      {/* Get Started CTA */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-8 text-center">
        <h2 className="text-2xl font-semibold text-text-primary mb-3">
          <T>Ready to Get Started?</T>
        </h2>
        <p className="text-text-secondary mb-6 max-w-lg mx-auto">
          <T>Follow our step-by-step guide to deploy your own IntuneGet instance.
          The complete setup takes about 1-2 hours.</T>
        </p>
        <Link
          href="/docs/getting-started"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent-cyan text-bg-deepest font-medium transition-all duration-200 hover:bg-accent-cyan-bright hover:shadow-glow-cyan"
        >
          <Rocket className="h-5 w-5" />
          <T>Start Setup Guide</T>
        </Link>
      </section>
    </div>
  );
}
