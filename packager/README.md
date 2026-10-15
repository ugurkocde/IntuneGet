# IntuneGet Packager

Local Windows packaging service for IntuneGet - enables true self-hosting without GitHub Actions dependency.

## Overview

The IntuneGet Packager is a Node.js application that runs on Windows and handles:

1. Polling for packaging jobs from the database
2. Downloading application installers
3. Creating PSADT (PowerShell App Deployment Toolkit) packages
4. Converting packages to `.intunewin` format using IntuneWinAppUtil.exe
5. Uploading packages to Microsoft Intune via Graph API

## Requirements

- Windows 10/11 or Windows Server 2019+
- Node.js 22 or later
- Network access to:
  - Your IntuneGet web app API (API mode) or Supabase database (Supabase mode)
  - Microsoft Graph API (graph.microsoft.com)
  - Application installer URLs

## Installation

### Option 1: Install globally via npm

```bash
npm install -g @ugurkocde/intuneget-packager
```

### Option 2: Use npx without installing

```bash
npx @ugurkocde/intuneget-packager
```

## Configuration

Create a `.env` file in your working directory or set environment variables:

### Required Variables

```env
# Azure AD / Microsoft Entra ID
AZURE_CLIENT_ID=your-app-registration-client-id
AZURE_CLIENT_SECRET=your-app-registration-client-secret

# API mode (recommended for sqlite web mode)
INTUNEGET_API_URL=https://your-intuneget-instance.com
PACKAGER_API_KEY=your-shared-packager-api-key

# Supabase mode (use instead of API mode for supabase web mode)
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Optional Variables

```env
# Packager Identity (auto-generated if not set)
PACKAGER_ID=my-packager-01

# Polling Configuration
POLL_INTERVAL=5000          # Milliseconds between polls (default: 5000)
STALE_JOB_TIMEOUT=300000    # Consider job stale after this many ms (default: 5 min)

# Directory Paths
WORK_DIR=./work             # Working directory for packages
TOOLS_DIR=./tools           # Tools directory (IntuneWinAppUtil, PSADT)
```

## Usage

### Start the packager

```bash
# Using globally installed package
intuneget-packager

# Using npx
npx @ugurkocde/intuneget-packager

# With verbose logging
intuneget-packager --verbose

# With debug logging
intuneget-packager --debug

# Dry run (validate config without processing)
intuneget-packager --dry-run
```

### Check configuration

```bash
intuneget-packager check
```

### Download tools

```bash
intuneget-packager setup
```

## Architecture

```
                                    +-------------------+
                                    |   IntuneGet       |
                                    |   Web App         |
                                    +--------+----------+
                                             |
                                             | Creates jobs
                                             v
+---------------------------+       +--------+----------+
|   IntuneGet Packager      |       |    Supabase       |
|   (this service)          | <---> |    Database       |
|   - Polls for jobs        |       |                   |
|   - Processes packages    |       +-------------------+
|   - Uploads to Intune     |
+------------+--------------+
             |
             | Uploads via Graph API
             v
+---------------------------+
|   Microsoft Intune        |
|   (tenant)                |
+---------------------------+
```

## How It Works

1. **Web App** creates a packaging job in the database with status `queued`
2. **Packager** polls the database every 5 seconds for queued jobs
3. **Packager** atomically claims a job (updates status to `packaging`)
4. **Packager** downloads the installer, creates PSADT package, and converts to `.intunewin`
5. **Packager** uploads the package to Intune via Microsoft Graph API
6. **Packager** updates job status to `deployed` with Intune app ID and URL

## Scaling

You can run multiple packager instances for increased throughput:

- Each packager has a unique ID (auto-generated or configured)
- Jobs are claimed atomically (only one packager processes each job)
- Stale jobs (claimed but no heartbeat) are automatically recovered

## Running as a Windows Service

For production deployments, you may want to run the packager as a Windows service:

### Using NSSM (Non-Sucking Service Manager)

1. Download NSSM from https://nssm.cc/
2. Install the service:

```cmd
nssm install IntuneGetPackager "C:\Program Files\nodejs\node.exe" "C:\path\to\node_modules\@intuneget\packager\dist\index.js"
nssm set IntuneGetPackager AppDirectory "C:\IntuneGet"
nssm set IntuneGetPackager AppStdout "C:\IntuneGet\logs\packager.log"
nssm set IntuneGetPackager AppStderr "C:\IntuneGet\logs\packager-error.log"
nssm start IntuneGetPackager
```

### Using PM2

1. Install PM2: `npm install -g pm2`
2. Start the packager:

```bash
pm2 start intuneget-packager --name "intuneget-packager"
pm2 save
pm2 startup
```

## Troubleshooting

### Common Issues

**"Configuration issues found"**
- Run `intuneget-packager check` to see detailed configuration errors
- Ensure all required environment variables are set

**"Failed to acquire access token"**
- Verify AZURE_CLIENT_ID and AZURE_CLIENT_SECRET are correct
- Ensure the app registration has DeviceManagementApps.ReadWrite.All permission
- Check that admin consent has been granted for the target tenant

**"IntuneWinAppUtil.exe not found"**
- Run `intuneget-packager setup` to download required tools
- Or manually place IntuneWinAppUtil.exe in the tools directory

**Jobs not being picked up**
- Ensure PACKAGER_MODE=local is set in your web app's configuration
- In API mode, verify `INTUNEGET_API_URL` and `PACKAGER_API_KEY`
- In Supabase mode, verify `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

### Logs

The packager logs to stdout/stderr. Use `--verbose` or `--debug` for more detailed logging.

## Security Considerations

- The packager uses either `PACKAGER_API_KEY` (API mode) or Supabase service role key (Supabase mode)
- Keep the `.env` file secure and never commit it to version control
- The AZURE_CLIENT_SECRET should be rotated regularly
- Consider running the packager on a dedicated machine or container

## License

MIT

## HTTP and HTTPS proxies

Set `HTTP_PROXY` for HTTP destinations and `HTTPS_PROXY` for HTTPS destinations in the service environment or its working directory `.env` file. Lowercase names take precedence when both are nonempty. Settings are loaded at startup; restart the service after changing them. A proxy origin may use HTTP or HTTPS; a missing scheme means HTTP. TLS certificate validation stays enabled.

The configured route covers API and Supabase polling, MSAL client credential requests, Graph, installer and tool downloads, icons and Azure block uploads. Managed identity keeps the Azure SDK credential path. No proxy configuration preserves the existing default transports. HTTP and HTTPS destination settings are independent; set both when both types need a proxy.

`NO_PROXY` (or `no_proxy`) accepts comma or whitespace separated hostnames, optional ports, IPv6 addresses in brackets, and `*` for all hosts. A hostname also matches subdomains on a label boundary. `.example.com` and `*.example.com` have the same meaning as `example.com`. A specified port must match, including the default 80 or 443. CIDR ranges are not supported. The route is selected again on redirects.

Basic proxy credentials may be supplied as percent encoded userinfo in the proxy URL. Keep that environment private. Plain HTTP proxy traffic is visible to the configured proxy; HTTPS destinations use CONNECT and retain TLS validation. Negotiate or Kerberos proxy authentication is not enabled. Avoid verbose network debug logging when credentials are configured.
