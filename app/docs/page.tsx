import Link from "next/link";
import { Metadata } from "next";
import {
  Rocket,
  Cloud,
  Database,
  Github,
  Container,
  HelpCircle,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Shield,
  Server,
} from "lucide-react";
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
};

const quickLinks = [
  {
    title: "Getting Started",
    href: "/docs/getting-started",
    icon: Rocket,
    description: "Complete setup walkthrough from zero to deployment",
  },
  {
    title: "Azure AD Setup",
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
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          Self-Hosting Documentation
        </h1>
        <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
          IntuneGet is 100% open source and designed to be self-hosted. This
          documentation will guide you through deploying your own instance,
          giving you full control over your data and infrastructure.
        </p>
      </div>

      {/* What is IntuneGet */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          What is IntuneGet?
        </h2>
        <p className="text-zinc-400 leading-relaxed mb-4">
          IntuneGet bridges the gap between Winget and Microsoft Intune. It
          automatically packages applications from the Winget repository and
          uploads them to your Intune environment, streamlining app deployment
          with just a few clicks.
        </p>
        <p className="text-zinc-400 leading-relaxed">
          The self-hosted version gives you complete control over your
          deployment pipeline, data storage, and authentication - perfect for
          organizations with specific security or compliance requirements.
        </p>
      </section>

      {/* Hosted vs Self-Hosted */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Hosted vs Self-Hosted
        </h2>
        <p className="text-zinc-400 leading-relaxed mb-6">
          Compare the two deployment options to decide which is right for you:
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader className="w-1/3">Feature</TableHeader>
              <TableHeader className="w-1/3">Hosted (intuneget.com)</TableHeader>
              <TableHeader className="w-1/3">Self-Hosted</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium text-white">Setup Time</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <Clock className="h-4 w-4" />
                  Instant
                </span>
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-warning">
                  <Clock className="h-4 w-4" />
                  1-2 hours
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-white">Cost</TableCell>
              <TableCell>Free (hosted by maintainer)</TableCell>
              <TableCell>Free tier services available</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-white">Data Control</TableCell>
              <TableCell>Shared infrastructure</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <CheckCircle className="h-4 w-4" />
                  Full control
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-white">Customization</TableCell>
              <TableCell>Limited</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <CheckCircle className="h-4 w-4" />
                  Unlimited
                </span>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-white">Maintenance</TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 text-status-success">
                  <CheckCircle className="h-4 w-4" />
                  Automatic
                </span>
              </TableCell>
              <TableCell>Self-managed</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium text-white">Updates</TableCell>
              <TableCell>Automatic</TableCell>
              <TableCell>Manual (git pull)</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </section>

      {/* Is Self-Hosting Right for You */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Is Self-Hosting Right for You?
        </h2>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Good fit */}
          <div className="rounded-lg border border-status-success/20 bg-status-success/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-status-success mb-4">
              <CheckCircle className="h-5 w-5" />
              Self-hosting is great if you:
            </h3>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                Need full control over your data
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                Have compliance requirements (data residency, etc.)
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                Want to customize the application
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                Are comfortable with basic DevOps tasks
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-success mt-1">-</span>
                Have existing cloud infrastructure
              </li>
            </ul>
          </div>

          {/* Not ideal */}
          <div className="rounded-lg border border-status-warning/20 bg-status-warning/5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-status-warning mb-4">
              <XCircle className="h-5 w-5" />
              Consider hosted if you:
            </h3>
            <ul className="space-y-2 text-sm text-zinc-300">
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                Want to get started immediately
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                Prefer zero maintenance overhead
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                Don&apos;t have specific data residency needs
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                Are evaluating the tool for the first time
              </li>
              <li className="flex items-start gap-2">
                <span className="text-status-warning mt-1">-</span>
                Have limited technical resources
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Requirements */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">Requirements</h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-accent-cyan/10 p-2">
                <Clock className="h-5 w-5 text-accent-cyan" />
              </div>
              <h3 className="font-semibold text-white">Time</h3>
            </div>
            <p className="text-sm text-zinc-400">
              Initial setup takes 1-2 hours. Occasional updates may take 15-30
              minutes.
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-accent-cyan/10 p-2">
                <DollarSign className="h-5 w-5 text-accent-cyan" />
              </div>
              <h3 className="font-semibold text-white">Cost</h3>
            </div>
            <p className="text-sm text-zinc-400">
              Completely free. SQLite database included. Optional GitHub Actions
              (2000 min/month for private repos).
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="rounded-lg bg-accent-cyan/10 p-2">
                <Shield className="h-5 w-5 text-accent-cyan" />
              </div>
              <h3 className="font-semibold text-white">Access</h3>
            </div>
            <p className="text-sm text-zinc-400">
              Azure AD permissions to create app registrations (admin access
              helpful but not required).
            </p>
          </div>
        </div>

        <Callout type="info" title="Accounts You'll Need">
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>Microsoft Azure</strong> - Access to create Entra ID app
              registrations
            </li>
            <li>
              <strong>GitHub</strong> - Free account (optional, only if using GitHub Actions for packaging)
            </li>
            <li>
              <strong>Hosting</strong> - Docker (recommended) or any Node.js host
            </li>
          </ul>
        </Callout>
      </section>

      {/* Quick Links */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-6">
          Documentation Sections
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="group rounded-lg border border-white/10 bg-bg-surface p-5 transition-all duration-200 hover:border-accent-cyan/30 hover:bg-bg-elevated"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-accent-cyan/10 p-2.5 transition-colors group-hover:bg-accent-cyan/20">
                    <Icon className="h-5 w-5 text-accent-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white group-hover:text-accent-cyan transition-colors">
                      {link.title}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-500">
                      {link.description}
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
        <h2 className="text-2xl font-semibold text-white mb-4">
          Architecture Overview
        </h2>
        <p className="text-zinc-400 leading-relaxed mb-6">
          Self-hosted IntuneGet runs entirely on your infrastructure with zero external dependencies:
        </p>

        <div className="rounded-lg border border-white/10 bg-bg-surface p-6 font-mono text-sm">
          <pre className="text-zinc-400 overflow-x-auto">
{`+----------------------------------+       +--------------------------------+
|         DOCKER CONTAINER         |       |      WINDOWS MACHINE           |
+----------------------------------+       +--------------------------------+
|  Next.js Web App                 |       |  Packager Service              |
|  - Embedded SQLite database      |       |  - Uses HTTP API only          |
|  - /api/packager/jobs endpoints  |<------|  - No database credentials     |
|  - All data stored locally       |       |  - Simple API key auth         |
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
            <h4 className="font-medium text-white mb-1">Web Application</h4>
            <p className="text-xs text-zinc-500">
              Next.js app with embedded SQLite database
            </p>
          </div>
          <div className="text-center p-4">
            <Container className="h-8 w-8 text-accent-cyan mx-auto mb-2" />
            <h4 className="font-medium text-white mb-1">Local Packager</h4>
            <p className="text-xs text-zinc-500">
              Windows service for .intunewin packaging
            </p>
          </div>
          <div className="text-center p-4">
            <Database className="h-8 w-8 text-accent-cyan mx-auto mb-2" />
            <h4 className="font-medium text-white mb-1">SQLite Database</h4>
            <p className="text-xs text-zinc-500">
              Local file-based storage, easy backup
            </p>
          </div>
        </div>
      </section>

      {/* Get Started CTA */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-8 text-center">
        <h2 className="text-2xl font-semibold text-white mb-3">
          Ready to Get Started?
        </h2>
        <p className="text-zinc-400 mb-6 max-w-lg mx-auto">
          Follow our step-by-step guide to deploy your own IntuneGet instance.
          The complete setup takes about 1-2 hours.
        </p>
        <Link
          href="/docs/getting-started"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent-cyan text-bg-deepest font-medium transition-all duration-200 hover:bg-accent-cyan-bright hover:shadow-glow-cyan"
        >
          <Rocket className="h-5 w-5" />
          Start Setup Guide
        </Link>
      </section>
    </div>
  );
}
