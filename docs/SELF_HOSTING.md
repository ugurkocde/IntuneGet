# Self-Hosting Guide

This guide covers deploying IntuneGet on your own infrastructure.

## Deployment Modes

IntuneGet supports two self-hosting modes:

| Mode | Packaging Pipeline | Best For |
|------|-------------------|----------|
| **GitHub Actions** (default) | GitHub Actions Windows runners | Simpler setup, no Windows server needed |
| **Local Packager** | Self-hosted Windows machine | True self-hosting, air-gapped environments |

## Prerequisites

Before you begin, ensure you have:

1. **Supabase Account** - [supabase.com](https://supabase.com) (required only when `DATABASE_MODE=supabase`)
2. **Microsoft Entra ID** - Access to create app registrations
3. **GitHub Account** - For the packaging pipeline (GitHub Actions mode only)
4. **Docker** (optional) - For containerized deployment
5. **Windows Machine** - For local packager mode only

## Deployment Options

### Option 1: Docker Compose (Recommended)

The simplest way to self-host IntuneGet.

```bash
# Clone the repository
git clone https://github.com/ugurkocde/IntuneGet.git
cd IntuneGet

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your configuration (see Configuration section below)

# Start the application
docker-compose up -d
```

The application will be available at `http://localhost:3000`.

> **Note on environment variables and Docker**: The Docker image is built without
> any `NEXT_PUBLIC_*` environment variables baked in. Instead, these values are
> injected at runtime when the container starts. This means you only need to
> set your variables in the `environment` section of `docker-compose.yml` (or
> in a `.env` file that Docker Compose loads). No build arguments or custom
> image builds are required. See
> [How Runtime Environment Injection Works](#how-runtime-environment-injection-works)
> for technical details.

### Option 2: Vercel

Deploy directly to Vercel for a managed hosting experience.

1. Fork the repository
2. Create a new project in Vercel
3. Connect your forked repository
4. Add environment variables in Vercel dashboard
5. Deploy

### Option 3: Manual Deployment

For other hosting providers or bare metal.

```bash
# Clone and install
git clone https://github.com/ugurkocde/IntuneGet.git
cd IntuneGet
npm install

# Build for production
npm run build

# Start production server
npm start
```

For process management, use PM2:

```bash
npm install -g pm2
pm2 start npm --name "intuneget" -- start
pm2 save
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_MODE` | `supabase` (default) or `sqlite` |
| `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` | Azure AD application ID |
| `AZURE_AD_CLIENT_SECRET` | Azure AD client secret (`AZURE_CLIENT_SECRET` also supported) |
| `NEXT_PUBLIC_URL` | Your application's public URL |

If `DATABASE_MODE=supabase`, also set:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

If `DATABASE_MODE=sqlite`, also set:

| Variable | Description |
|----------|-------------|
| `PACKAGER_API_KEY` | Shared key between web app and local packager API mode |

### Pipeline Configuration

| Variable | Description |
|----------|-------------|
| `PACKAGER_MODE` | `github` (default) or `local` |
| `GITHUB_PAT` | GitHub PAT (required for github mode) |
| `GITHUB_OWNER` | GitHub username/org (required for github mode) |
| `GITHUB_WORKFLOWS_REPO` | Private repository containing packaging workflow (required for github mode) |
| `GITHUB_REPO` | Public repository name (optional, for reference) |
| `CALLBACK_SECRET` | Secret for webhook verification (github mode) |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Plausible analytics domain | (disabled) |
| `BEEHIIV_API_KEY` | Newsletter integration | (disabled) |

## Setup Steps

### 1. Database Setup

See [DATABASE_SETUP.md](DATABASE_SETUP.md) for detailed Supabase configuration.

Quick start:
1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run the SQL migrations from the `supabase/migrations` folder
3. Copy the project URL and keys to your `.env.local`

### 2. Azure AD Setup

See [AZURE_AD_SETUP.md](AZURE_AD_SETUP.md) for detailed instructions.

Quick start:
1. Create a multi-tenant app registration
2. Add required API permissions
3. Create a client secret
4. Copy the client ID and secret to your `.env.local`

### 3. GitHub Actions Setup

See [GITHUB_ACTIONS_SETUP.md](GITHUB_ACTIONS_SETUP.md) for detailed instructions.

Quick start:
1. Fork the IntuneGet repository
2. Create a Personal Access Token with `repo` and `workflow` scopes
3. Add secrets to your private workflows repository (`GITHUB_WORKFLOWS_REPO`)
4. Update `.env.local` to point to your fork

### 4. Configure Callback URL (GitHub Actions Mode)

After deployment, update:
1. `NEXT_PUBLIC_URL` in your environment variables
2. Redirect URIs in your Azure AD app registration

### 5. Local Packager Setup (Optional - True Self-Hosting)

For true self-hosting without GitHub Actions dependency, use the local packager.

#### 5.1 Configure Web App for Local Mode

Set in your web app's environment:

```env
PACKAGER_MODE=local
```

#### 5.2 Install the Packager on Windows

On a Windows machine with Node.js 18+:

```bash
# Install globally
npm install -g @ugurkocde/intuneget-packager

# Or use npx
npx @ugurkocde/intuneget-packager
```

#### 5.3 Configure the Packager

Create a `.env` file in your packager working directory:

```env
# Recommended API mode (for sqlite web mode)
INTUNEGET_API_URL=https://your-intuneget-instance.com
PACKAGER_API_KEY=your-packager-api-key

# Azure AD (same credentials as web app)
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

# Optional Supabase mode (for supabase web mode)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional
PACKAGER_ID=packager-01
POLL_INTERVAL=5000
```

#### 5.4 Start the Packager

```bash
# Start with verbose logging
intuneget-packager --verbose

# Or run as a Windows service (see packager README)
```

#### 5.5 Verify Setup

Check the packager health endpoint:

```bash
curl https://your-intuneget-instance.com/api/packager/health
```

Expected response:
```json
{
  "status": "healthy",
  "mode": "local",
  "stats": {
    "activePackagers": 1,
    "queuedJobs": 0
  }
}
```

For more details, see the [Packager README](../packager/README.md).

## How Runtime Environment Injection Works

Next.js normally inlines `NEXT_PUBLIC_*` environment variables into the client
JavaScript bundle at **build time**. In a Docker deployment the image is built
once (without tenant-specific values), so those variables would be empty in the
browser.

IntuneGet solves this with a runtime injection mechanism:

1. The root `layout.tsx` (a server component) reads `process.env` at **request
   time** and renders a `<script>` tag that sets `window.__RUNTIME_CONFIG__`
   with the current value of `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`.
2. Client-side code (`lib/runtime-config.ts`) calls `getPublicClientId()`,
   which checks `window.__RUNTIME_CONFIG__` first and falls back to
   `process.env` for Vercel and local development builds where the value is
   already inlined.

This means:

- **Docker / self-hosted**: Pass `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` in the
  container's `environment` section. It will be read from the server process at
  runtime and forwarded to the browser automatically. No build arguments or
  custom Dockerfile changes are needed.
- **Vercel / local development**: The standard `NEXT_PUBLIC_*` build-time
  behavior works as usual. The runtime config layer is a transparent no-op.

---

## Reverse Proxy Configuration

### Nginx

```nginx
server {
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
}
```

### Caddy

```
intuneget.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## SSL/TLS

For production deployments, always use HTTPS:

- **Vercel**: Automatic SSL
- **Docker + Caddy**: Automatic Let's Encrypt
- **Docker + Nginx**: Use certbot or similar

## Health Checks

The application exposes a health endpoint:

```bash
curl http://localhost:3000/api/health
```

Response:
```json
{
  "status": "degraded",
  "mode": "self-hosted",
  "services": {
    "database": true,
    "auth": true,
    "pipeline": false
  }
}
```

## Updating

To update your self-hosted instance:

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

## Troubleshooting

### Application won't start

1. Check environment variables are set correctly
2. Verify Supabase connection: `curl $NEXT_PUBLIC_SUPABASE_URL/rest/v1/`
3. Check logs: `docker-compose logs -f`

### Authentication issues

1. Verify Azure AD app registration is multi-tenant
2. Check redirect URIs match your deployment URL
3. Ensure admin consent was granted
4. If MSAL login redirects fail or the `client_id` parameter is missing from
   authentication URLs, confirm that `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` is set
   in the Docker container's environment (see
   [How Runtime Environment Injection Works](#how-runtime-environment-injection-works))

### Packaging pipeline not working

1. Verify GitHub PAT has correct scopes
2. Verify `GITHUB_WORKFLOWS_REPO` is configured and contains the packaging workflow
3. Verify `CALLBACK_SECRET` matches in both places

## Support

- GitHub Issues: [github.com/ugurkocde/IntuneGet/issues](https://github.com/ugurkocde/IntuneGet/issues)
- Documentation: [github.com/ugurkocde/IntuneGet/docs](https://github.com/ugurkocde/IntuneGet/tree/main/docs)
