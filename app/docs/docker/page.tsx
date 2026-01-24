import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Container, AlertCircle, Server, Shield } from "lucide-react";
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
  title: "Docker Deployment | IntuneGet Docs",
  description:
    "Deploy IntuneGet with Docker and Docker Compose. Complete guide for containerized self-hosting.",
};

export default function DockerPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          Docker Deployment
        </h1>
        <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
          Deploy IntuneGet using Docker for portable, consistent deployments on any
          infrastructure.
        </p>
      </div>

      {/* Prerequisites */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">Prerequisites</h2>
        <ul className="list-disc list-inside space-y-2 text-zinc-300">
          <li>
            Docker installed (
            <a
              href="https://docs.docker.com/get-docker/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-cyan hover:underline"
            >
              Install Docker
            </a>
            )
          </li>
          <li>Docker Compose (usually included with Docker Desktop)</li>
          <li>Completed Azure AD setup</li>
          <li>A Windows machine for running the local packager</li>
        </ul>
      </section>

      {/* Quick Start */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">Quick Start</h2>
        <p className="text-zinc-400 mb-4">
          The fastest way to deploy IntuneGet with Docker:
        </p>

        <CodeBlock language="bash">
{`# Clone your fork (or the main repo)
git clone https://github.com/YOUR_USERNAME/IntuneGet-Website.git
cd IntuneGet-Website

# Copy and configure environment
cp .env.example .env.local

# Edit .env.local with your values
# (Use your favorite editor)

# Start the application
docker-compose up -d`}
        </CodeBlock>

        <p className="text-zinc-400 mt-4">
          The application will be available at{" "}
          <code className="text-accent-cyan">http://localhost:3000</code>
        </p>
      </section>

      {/* Step by Step */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-6">
          Step-by-Step Setup
        </h2>

        <Steps>
          <StepIndicator step={1} title="Clone the Repository">
            <CodeBlock language="bash">
{`git clone https://github.com/YOUR_USERNAME/IntuneGet-Website.git
cd IntuneGet-Website`}
            </CodeBlock>
          </StepIndicator>

          <StepIndicator step={2} title="Configure Environment Variables">
            <p className="mb-4">Copy the example environment file:</p>
            <CodeBlock language="bash">cp .env.example .env.local</CodeBlock>

            <p className="mt-4 mb-4">
              Edit <code>.env.local</code> and fill in all required values:
            </p>
            <CodeBlock language="bash" filename=".env.local">
{`# Database (SQLite mode for self-hosting)
DATABASE_MODE=sqlite
DATABASE_PATH=/data/intuneget.db

# Local Packager
PACKAGER_MODE=local
PACKAGER_API_KEY=your-secure-random-key

# Azure AD
NEXT_PUBLIC_AZURE_AD_CLIENT_ID=your-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret

# Application URL
NEXT_PUBLIC_URL=http://localhost:3000`}
            </CodeBlock>
          </StepIndicator>

          <StepIndicator step={3} title="Start with Docker Compose">
            <CodeBlock language="bash">
{`# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down`}
            </CodeBlock>
          </StepIndicator>

          <StepIndicator step={4} title="Verify Deployment" isLast>
            <p className="mb-4">Check that everything is running:</p>
            <CodeBlock language="bash">
{`# Check container status
docker-compose ps

# Test health endpoint
curl http://localhost:3000/api/health`}
            </CodeBlock>

            <p className="mt-4 text-zinc-400">
              Expected health response:
            </p>
            <CodeBlock language="json">
{`{
  "status": "healthy",
  "mode": "self-hosted",
  "services": {
    "database": true,
    "auth": true,
    "pipeline": true
  }
}`}
            </CodeBlock>
          </StepIndicator>
        </Steps>
      </section>

      {/* Docker Compose Configuration */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Docker Compose Configuration
        </h2>
        <p className="text-zinc-400 mb-4">
          The included <code>docker-compose.yml</code> provides a production-ready
          configuration with SQLite persistence:
        </p>

        <CodeBlock language="yaml" filename="docker-compose.yml" showLineNumbers>
{`version: '3.8'

services:
  intuneget:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_MODE=sqlite
      - DATABASE_PATH=/data/intuneget.db
      - PACKAGER_MODE=local
      - PACKAGER_API_KEY=\${PACKAGER_API_KEY}
      - NEXT_PUBLIC_AZURE_AD_CLIENT_ID=\${NEXT_PUBLIC_AZURE_AD_CLIENT_ID}
      - AZURE_AD_CLIENT_SECRET=\${AZURE_AD_CLIENT_SECRET}
      - NEXT_PUBLIC_URL=\${NEXT_PUBLIC_URL}
    volumes:
      - intuneget-data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  intuneget-data:`}
        </CodeBlock>

        <Callout type="info" title="Data Persistence">
          <p>
            The <code>intuneget-data</code> volume ensures your SQLite database
            persists across container restarts and updates. Never remove this volume
            unless you want to start fresh.
          </p>
        </Callout>
      </section>

      {/* Reverse Proxy */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Reverse Proxy Configuration
        </h2>
        <p className="text-zinc-400 mb-4">
          For production, place IntuneGet behind a reverse proxy for SSL
          termination:
        </p>

        <Collapsible title="Nginx Configuration" defaultOpen>
          <CodeBlock language="nginx" filename="nginx.conf">
{`server {
    listen 80;
    server_name intuneget.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}`}
          </CodeBlock>
        </Collapsible>

        <Collapsible title="Caddy Configuration (Automatic SSL)">
          <CodeBlock language="text" filename="Caddyfile">
{`intuneget.yourdomain.com {
    reverse_proxy localhost:3000
}`}
          </CodeBlock>
          <p className="text-sm text-zinc-400 mt-3">
            Caddy automatically provisions and renews SSL certificates from
            Let&apos;s Encrypt.
          </p>
        </Collapsible>

        <Collapsible title="Traefik Configuration">
          <CodeBlock language="yaml" filename="docker-compose.yml">
{`version: '3.8'

services:
  intuneget:
    # ... your existing config ...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.intuneget.rule=Host(\`intuneget.yourdomain.com\`)"
      - "traefik.http.routers.intuneget.entrypoints=websecure"
      - "traefik.http.routers.intuneget.tls.certresolver=letsencrypt"`}
          </CodeBlock>
        </Collapsible>
      </section>

      {/* SSL/TLS */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">SSL/TLS</h2>

        <Callout type="warning" title="Always Use HTTPS in Production">
          <p>
            IntuneGet handles authentication tokens and interacts with Microsoft
            APIs. Always use HTTPS in production environments.
          </p>
        </Callout>

        <div className="grid gap-4 sm:grid-cols-3 mt-6">
          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-cyan" />
              Caddy
            </h3>
            <p className="text-sm text-zinc-400">
              Automatic Let&apos;s Encrypt certificates
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-cyan" />
              Nginx + Certbot
            </h3>
            <p className="text-sm text-zinc-400">
              Run certbot for certificate management
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-semibold text-white mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-cyan" />
              Cloud Load Balancer
            </h3>
            <p className="text-sm text-zinc-400">
              AWS ALB, GCP LB, or Azure App Gateway
            </p>
          </div>
        </div>
      </section>

      {/* Updating */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Updating Your Deployment
        </h2>
        <p className="text-zinc-400 mb-4">
          To update to the latest version:
        </p>

        <CodeBlock language="bash">
{`# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d`}
        </CodeBlock>

        <Callout type="info" title="Database Migrations">
          <p>
            SQLite database schema is managed automatically. After major updates,
            the schema will be updated on application startup. Check the release
            notes for any manual migration steps if needed.
          </p>
        </Callout>
      </section>

      {/* Production Checklist */}
      <section>
        <h2 className="text-2xl font-semibold text-white mb-4">
          Production Checklist
        </h2>

        <div className="space-y-3">
          {[
            "Environment variables are set correctly",
            "HTTPS is configured with valid certificates",
            "NEXT_PUBLIC_URL matches your production domain",
            "Azure AD redirect URIs include your production URL",
            "Local packager is running and connected",
            "Health checks are passing",
            "SQLite database backup schedule configured",
            "Logs are being collected",
            "Monitoring/alerting is set up",
          ].map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-bg-surface"
            >
              <div className="h-5 w-5 rounded-full border-2 border-zinc-600 flex items-center justify-center flex-shrink-0">
                <div className="h-2 w-2 rounded-full bg-zinc-600" />
              </div>
              <span className="text-zinc-300">{item}</span>
            </div>
          ))}
        </div>
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
              Container fails to start
            </h3>
            <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
              <li>
                Check logs: <code>docker-compose logs -f</code>
              </li>
              <li>Verify .env.local exists and has correct values</li>
              <li>Ensure port 3000 is not in use</li>
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Database errors
            </h3>
            <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
              <li>Verify DATABASE_MODE=sqlite is set</li>
              <li>Check volume mount for /data directory</li>
              <li>
                Verify write permissions:{" "}
                <code>docker exec intuneget ls -la /data</code>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-white/10 bg-bg-surface p-4">
            <h3 className="font-medium text-white mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              Build fails
            </h3>
            <ul className="list-disc list-inside text-sm text-zinc-300 space-y-1">
              <li>Ensure Docker has enough memory (at least 4GB)</li>
              <li>
                Try building with no cache:{" "}
                <code>docker-compose build --no-cache</code>
              </li>
              <li>Check for any TypeScript errors in the codebase</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-white mb-3">Next Steps</h2>
        <p className="text-zinc-400 mb-4">
          Your Docker deployment is ready! Check the troubleshooting guide if you
          run into any issues.
        </p>
        <Link
          href="/docs/troubleshooting"
          className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
        >
          View Troubleshooting Guide
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
