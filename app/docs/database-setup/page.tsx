import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Database, CheckCircle, HardDrive, Shield } from "lucide-react";
import {
  Callout,
  CodeBlock,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
} from "@/components/docs";

export const metadata: Metadata = {
  title: "Database Setup | IntuneGet Docs",
  description:
    "SQLite database for IntuneGet self-hosting. Zero-configuration, embedded database that just works.",
};

export default function DatabaseSetupPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          Database Setup
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          IntuneGet uses SQLite for self-hosted deployments - a zero-configuration,
          embedded database that requires no external services.
        </p>
      </div>

      {/* Overview */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Overview</h2>
        <p className="text-text-secondary mb-4">
          The self-hosted version of IntuneGet uses SQLite, providing:
        </p>
        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-center gap-3 mb-3">
              <Database className="h-5 w-5 text-accent-cyan" />
              <h3 className="font-semibold text-text-primary">Zero Configuration</h3>
            </div>
            <p className="text-sm text-text-secondary">
              Database is created automatically on first run. No setup required.
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-center gap-3 mb-3">
              <HardDrive className="h-5 w-5 text-accent-cyan" />
              <h3 className="font-semibold text-text-primary">Simple Backups</h3>
            </div>
            <p className="text-sm text-text-secondary">
              Just copy the SQLite file. No complex database dumps needed.
            </p>
          </div>
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <div className="flex items-center gap-3 mb-3">
              <Shield className="h-5 w-5 text-accent-cyan" />
              <h3 className="font-semibold text-text-primary">Full Control</h3>
            </div>
            <p className="text-sm text-text-secondary">
              All data stays on your infrastructure. No external dependencies.
            </p>
          </div>
        </div>

        <Callout type="info" title="No External Database Needed">
          <p>
            Unlike the hosted version, self-hosted IntuneGet does not require any
            external database service. Everything is stored in a single SQLite file
            that is created and managed automatically.
          </p>
        </Callout>
      </section>

      {/* Configuration */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Configuration</h2>
        <p className="text-text-secondary mb-4">
          Configure the database using environment variables:
        </p>

        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Variable</TableHeader>
              <TableHeader>Description</TableHeader>
              <TableHeader>Default</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">DATABASE_MODE</code>
              </TableCell>
              <TableCell className="text-sm">
                Set to &quot;sqlite&quot; for self-hosted mode
              </TableCell>
              <TableCell>
                <code className="text-xs text-text-muted">supabase</code>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <code className="text-accent-cyan text-xs">DATABASE_PATH</code>
              </TableCell>
              <TableCell className="text-sm">
                Path to the SQLite database file
              </TableCell>
              <TableCell>
                <code className="text-xs text-text-muted">./data/intuneget.db</code>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        <CodeBlock language="bash" filename=".env.local">
{`# Enable SQLite mode
DATABASE_MODE=sqlite

# Optional: Custom database path
DATABASE_PATH=/data/intuneget.db`}
        </CodeBlock>
      </section>

      {/* Docker Volume */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Docker Volume Mount
        </h2>
        <p className="text-text-secondary mb-4">
          When using Docker, mount a volume to persist the database:
        </p>

        <CodeBlock language="yaml" filename="docker-compose.yml" showLineNumbers>
{`version: '3.8'

services:
  intuneget:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_MODE=sqlite
      - DATABASE_PATH=/data/intuneget.db
      - PACKAGER_MODE=local
      - PACKAGER_API_KEY=\${PACKAGER_API_KEY}
    volumes:
      - intuneget-data:/data
    restart: unless-stopped

volumes:
  intuneget-data:`}
        </CodeBlock>

        <Callout type="warning" title="Persist Your Data">
          <p>
            Always mount a volume for <code>/data</code> in Docker. Without a volume,
            the database will be lost when the container is recreated.
          </p>
        </Callout>
      </section>

      {/* Database Schema */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Database Schema</h2>
        <p className="text-text-secondary mb-4">
          The database schema is created automatically. It includes these tables:
        </p>

        <div className="space-y-4">
          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-accent-cyan" />
              packaging_jobs
            </h3>
            <p className="text-sm text-text-secondary">
              Tracks all packaging requests, their status, progress, and results.
              Includes job claiming for the local packager.
            </p>
          </div>

          <div className="rounded-lg border border-black/10 bg-white p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <Database className="h-4 w-4 text-accent-cyan" />
              upload_history
            </h3>
            <p className="text-sm text-text-secondary">
              Records successful deployments to Intune for reference and audit.
            </p>
          </div>
        </div>
      </section>

      {/* Backup & Recovery */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Backup & Recovery
        </h2>

        <h3 className="font-semibold text-text-primary mb-3">Creating Backups</h3>
        <p className="text-text-secondary mb-4">
          SQLite makes backups simple - just copy the database file:
        </p>

        <CodeBlock language="bash">
{`# From Docker host
docker cp intuneget-intuneget-1:/data/intuneget.db ./backup-$(date +%Y%m%d).db

# Or if using a volume mount
cp /path/to/data/intuneget.db ./backup-$(date +%Y%m%d).db`}
        </CodeBlock>

        <h3 className="font-semibold text-text-primary mt-6 mb-3">Restoring from Backup</h3>
        <CodeBlock language="bash">
{`# Stop the container first
docker-compose down

# Replace the database file
cp ./backup-20240115.db /path/to/data/intuneget.db

# Restart
docker-compose up -d`}
        </CodeBlock>

        <Callout type="tip" title="Automated Backups">
          <p>
            Set up a cron job or scheduled task to backup the database regularly:
          </p>
          <CodeBlock language="bash">
{`# Add to crontab (daily at 2am)
0 2 * * * cp /data/intuneget.db /backups/intuneget-$(date +\\%Y\\%m\\%d).db`}
          </CodeBlock>
        </Callout>
      </section>

      {/* Viewing Data */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">Viewing Data</h2>
        <p className="text-text-secondary mb-4">
          You can inspect the database using any SQLite client:
        </p>

        <CodeBlock language="bash">
{`# Using sqlite3 CLI
sqlite3 /data/intuneget.db

# Common queries
.tables                              # List all tables
SELECT * FROM packaging_jobs;        # View all jobs
SELECT * FROM packaging_jobs WHERE status = 'failed';  # View failed jobs`}
        </CodeBlock>

        <p className="text-text-secondary mt-4">
          GUI tools like{" "}
          <a
            href="https://sqlitebrowser.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-cyan hover:underline"
          >
            DB Browser for SQLite
          </a>{" "}
          or{" "}
          <a
            href="https://tableplus.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-cyan hover:underline"
          >
            TablePlus
          </a>{" "}
          also work well.
        </p>
      </section>

      {/* Migration from Supabase */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          Migration from Hosted Version
        </h2>
        <p className="text-text-secondary mb-4">
          If you&apos;re migrating from the hosted version (intuneget.com), note that
          job history and deployment records are not transferred. The self-hosted
          version starts fresh with an empty database.
        </p>

        <div className="space-y-3">
          {[
            "Deploy the self-hosted version with SQLite",
            "Configure Entra ID app registration for your new URL",
            "Install and configure the local packager",
            "Start fresh with new deployments",
          ].map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 rounded-lg border border-black/10 bg-white"
            >
              <CheckCircle className="h-5 w-5 text-status-success flex-shrink-0" />
              <span className="text-text-secondary">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3">Next Steps</h2>
        <p className="text-text-secondary mb-4">
          The database is configured automatically. Continue with Docker deployment
          to get your instance running.
        </p>
        <Link
          href="/docs/docker"
          className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
        >
          Continue to Docker Deployment
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
