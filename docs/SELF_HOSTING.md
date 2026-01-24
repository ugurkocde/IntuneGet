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

1. **Supabase Account** - [supabase.com](https://supabase.com) (free tier available, or self-hosted)
2. **Microsoft Entra ID** - Access to create app registrations
3. **GitHub Account** - For the packaging pipeline (GitHub Actions mode only)
4. **Docker** (optional) - For containerized deployment
5. **Windows Machine** - For local packager mode only

## Deployment Options

### Option 1: Docker Compose (Recommended)

The simplest way to self-host IntuneGet.

```bash
# Clone the repository
git clone https://github.com/ugurkocde/IntuneGet-Website.git
cd IntuneGet-Website

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your configuration (see Configuration section below)

# Start the application
docker-compose up -d
```

The application will be available at `http://localhost:3000`.

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
git clone https://github.com/ugurkocde/IntuneGet-Website.git
cd IntuneGet-Website
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
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` | Azure AD application ID |
| `AZURE_AD_CLIENT_SECRET` | Azure AD client secret |
| `NEXT_PUBLIC_URL` | Your application's public URL |

### Pipeline Configuration

| Variable | Description |
|----------|-------------|
| `PACKAGER_MODE` | `github` (default) or `local` |
| `GITHUB_PAT` | GitHub PAT (required for github mode) |
| `GITHUB_OWNER` | GitHub username/org (required for github mode) |
| `GITHUB_REPO` | Repository name (required for github mode) |
| `CALLBACK_SECRET` | Secret for webhook verification (github mode) |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SITE_PASSWORD` | Password-protect the app | (disabled) |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Plausible analytics domain | (disabled) |
| `NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL` | Custom Plausible script URL | (disabled) |
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
3. Add secrets to your forked repository
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
# Supabase (same as web app)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Azure AD (same credentials as web app)
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

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
  "status": "healthy",
  "mode": "self-hosted",
  "services": {
    "database": true,
    "auth": true,
    "pipeline": true
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

### Packaging pipeline not working

1. Verify GitHub PAT has correct scopes
2. Check the workflow exists in your forked repository
3. Verify `CALLBACK_SECRET` matches in both places

## Support

- GitHub Issues: [github.com/ugurkocde/IntuneGet-Website/issues](https://github.com/ugurkocde/IntuneGet-Website/issues)
- Documentation: [github.com/ugurkocde/IntuneGet-Website/docs](https://github.com/ugurkocde/IntuneGet-Website/tree/main/docs)
