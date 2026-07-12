import { Metadata } from "next";
import Link from "next/link";
import { T } from "gt-next";
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
  alternates: {
    canonical: "https://intuneget.com/docs/docker",
  },
  openGraph: {
    title: "Docker Deployment | IntuneGet Docs",
    description:
      "Deploy IntuneGet with Docker and Docker Compose. Complete guide for containerized self-hosting.",
  },
};

export default function DockerPage() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary sm:text-4xl">
          <T>Docker Deployment</T>
        </h1>
        <p className="mt-4 text-lg text-text-secondary leading-relaxed">
          <T>Deploy IntuneGet using Docker for portable, consistent deployments on any
          infrastructure.</T>
        </p>
      </div>

      {/* Prerequisites */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Prerequisites</T></h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <T>Docker installed (
            <a
              href="https://docs.docker.com/get-docker/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-cyan hover:underline"
            >
              Install Docker
            </a>
            )</T>
          </li>
          <li><T>Docker Compose (usually included with Docker Desktop)</T></li>
          <li><T>Completed Entra ID setup</T></li>
          <li><T>A Windows machine for running the local packager</T></li>
        </ul>
      </section>

      {/* Quick Start */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4"><T>Quick Start</T></h2>
        <p className="text-text-secondary mb-4">
          <T>The fastest way to deploy IntuneGet with Docker:</T>
        </p>

        <CodeBlock language="bash">
{`# Clone your fork (or the main repo)
git clone https://github.com/YOUR_USERNAME/IntuneGet.git
cd IntuneGet

# Copy and configure environment
cp .env.example .env.local

# Edit .env.local with your values
# (Use your favorite editor)

# Start the application
docker-compose up -d`}
        </CodeBlock>

        <p className="text-text-secondary mt-4">
          <T>The application will be available at{" "}
          <code className="text-accent-cyan">http://localhost:3000</code></T>
        </p>
      </section>

      {/* Step by Step */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-6">
          <T>Step-by-Step Setup</T>
        </h2>

        <Steps>
          <StepIndicator step={1} title="Clone the Repository">
            <CodeBlock language="bash">
{`git clone https://github.com/YOUR_USERNAME/IntuneGet.git
cd IntuneGet`}
            </CodeBlock>
          </StepIndicator>

          <StepIndicator step={2} title="Configure Environment Variables">
            <p className="mb-4"><T>Copy the example environment file:</T></p>
            <CodeBlock language="bash">cp .env.example .env.local</CodeBlock>

            <p className="mt-4 mb-4">
              <T>Edit <code>.env.local</code> and fill in all required values:</T>
            </p>
            <CodeBlock language="bash" filename=".env.local">
{`# Database (SQLite mode for self-hosting)
DATABASE_MODE=sqlite
DATABASE_PATH=/data/intuneget.db

# Local Packager
PACKAGER_MODE=local
PACKAGER_API_KEY=your-secure-random-key

# Entra ID
NEXT_PUBLIC_AZURE_AD_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

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
            <p className="mb-4"><T>Check that everything is running:</T></p>
            <CodeBlock language="bash">
{`# Check container status
docker-compose ps

# Test health endpoint
curl http://localhost:3000/api/health`}
            </CodeBlock>

            <p className="mt-4 text-text-secondary">
              <T>Expected health response:</T>
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
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Docker Compose Configuration</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>The included <code>docker-compose.yml</code> provides a production-ready
          configuration with SQLite persistence:</T>
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
      - AZURE_CLIENT_SECRET=\${AZURE_CLIENT_SECRET}
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
            <T>The <code>intuneget-data</code> volume ensures your SQLite database
            persists across container restarts and updates. Never remove this volume
            unless you want to start fresh.</T>
          </p>
        </Callout>
      </section>

      {/* Runtime Environment Injection */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>How Environment Variables Work in Docker</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>Next.js normally inlines <code>NEXT_PUBLIC_*</code> variables into the
          client JavaScript at <strong>build time</strong>. Since the Docker image
          is built without your specific configuration, IntuneGet uses runtime
          injection to ensure these values are available in the browser.</T>
        </p>
        <p className="text-text-secondary mb-4">
          <T>When a page is requested, the server reads{" "}
          <code>NEXT_PUBLIC_AZURE_AD_CLIENT_ID</code> from the container&apos;s
          environment and injects it into the HTML. Client-side code (such as
          MSAL authentication) reads this injected value, so your sign-in and
          consent URLs always contain the correct client ID.</T>
        </p>

        <Callout type="info" title="No Build Args Needed">
          <p>
            <T>You do not need to pass environment variables as Docker build arguments.
            Simply set them in the <code>environment</code> section of your{" "}
            <code>docker-compose.yml</code> (or via <code>.env.local</code>) and
            they will be picked up at runtime.</T>
          </p>
        </Callout>
      </section>

      {/* Reverse Proxy */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Reverse Proxy Configuration</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>For production, place IntuneGet behind a reverse proxy for SSL
          termination:</T>
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
          <p className="text-sm text-text-secondary mt-3">
            <T>Caddy automatically provisions and renews SSL certificates from
            Let&apos;s Encrypt.</T>
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
        <h2 className="text-2xl font-semibold text-text-primary mb-4">SSL/TLS</h2>

        <Callout type="warning" title="Always Use HTTPS in Production">
          <p>
            <T>IntuneGet handles authentication tokens and interacts with Microsoft
            APIs. Always use HTTPS in production environments.</T>
          </p>
        </Callout>

        <div className="grid gap-4 sm:grid-cols-3 mt-6">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-cyan" />
              <T>Caddy</T>
            </h3>
            <p className="text-sm text-text-secondary">
              <T>Automatic Let&apos;s Encrypt certificates</T>
            </p>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-cyan" />
              <T>Nginx + Certbot</T>
            </h3>
            <p className="text-sm text-text-secondary">
              <T>Run certbot for certificate management</T>
            </p>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-cyan" />
              <T>Cloud Load Balancer</T>
            </h3>
            <p className="text-sm text-text-secondary">
              <T>AWS ALB, GCP LB, or Azure App Gateway</T>
            </p>
          </div>
        </div>
      </section>

      {/* Updating */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Updating Your Deployment</T>
        </h2>
        <p className="text-text-secondary mb-4">
          <T>To update to the latest version:</T>
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
            <T>SQLite database schema is managed automatically. After major updates,
            the schema will be updated on application startup. Check the release
            notes for any manual migration steps if needed.</T>
          </p>
        </Callout>
      </section>

      {/* Production Checklist */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Production Checklist</T>
        </h2>

        <div className="space-y-3">
          {[
            "Environment variables are set correctly",
            "HTTPS is configured with valid certificates",
            "NEXT_PUBLIC_URL matches your production domain",
            "Entra ID redirect URIs include your production URL",
            "Local packager is running and connected",
            "Health checks are passing",
            "SQLite database backup schedule configured",
            "Logs are being collected",
            "Monitoring/alerting is set up",
          ].map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 rounded-lg border border-overlay/10 bg-bg-elevated"
            >
              <div className="h-5 w-5 rounded-full border-2 border-overlay/15 flex items-center justify-center flex-shrink-0">
                <div className="h-2 w-2 rounded-full bg-stone-300" />
              </div>
              <span className="text-text-secondary"><T>{item}</T></span>
            </div>
          ))}
        </div>
      </section>

      {/* Troubleshooting */}
      <section>
        <h2 className="text-2xl font-semibold text-text-primary mb-4">
          <T>Common Issues</T>
        </h2>

        <div className="space-y-4">
          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              <T>Container fails to start</T>
            </h3>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>
                <T>Check logs: <code>docker-compose logs -f</code></T>
              </li>
              <li><T>Verify .env.local exists and has correct values</T></li>
              <li><T>Ensure port 3000 is not in use</T></li>
            </ul>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              <T>Database errors</T>
            </h3>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li><T>Verify DATABASE_MODE=sqlite is set</T></li>
              <li><T>Check volume mount for /data directory</T></li>
              <li>
                <T>Verify write permissions:{" "}
                <code>docker exec intuneget ls -la /data</code></T>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              <T>Build fails</T>
            </h3>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li><T>Ensure Docker has enough memory (at least 4GB)</T></li>
              <li>
                <T>Try building with no cache:{" "}
                <code>docker-compose build --no-cache</code></T>
              </li>
              <li><T>Check for any TypeScript errors in the codebase</T></li>
            </ul>
          </div>

          <div className="rounded-lg border border-overlay/10 bg-bg-elevated p-4">
            <h3 className="font-medium text-text-primary mb-2 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-status-error" />
              AADSTS900144: Missing client_id in authentication URLs
            </h3>
            <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
              <li>
                This was caused by a bug in older versions where the client ID
                was not injected at runtime. Update to the latest version by
                pulling and rebuilding:{" "}
                <code>git pull && docker-compose up -d --build</code>
              </li>
              <li>
                Verify <code>NEXT_PUBLIC_AZURE_AD_CLIENT_ID</code> is set in
                your <code>docker-compose.yml</code> environment section or{" "}
                <code>.env.local</code>
              </li>
              <li>
                Open the browser console (F12) and run{" "}
                <code>window.__RUNTIME_CONFIG__</code> to confirm the client ID
                is being injected
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Next Steps */}
      <section className="rounded-lg border border-accent-cyan/20 bg-gradient-to-br from-accent-cyan/5 to-transparent p-6">
        <h2 className="text-xl font-semibold text-text-primary mb-3"><T>Next Steps</T></h2>
        <p className="text-text-secondary mb-4">
          <T>Your Docker deployment is ready! Check the troubleshooting guide if you
          run into any issues.</T>
        </p>
        <Link
          href="/docs/troubleshooting"
          className="inline-flex items-center gap-2 text-accent-cyan hover:underline"
        >
          <T>View Troubleshooting Guide</T>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
