# IntuneGet

**Deploy Winget applications to Microsoft Intune with a single click.**

IntuneGet streamlines your Microsoft Intune app deployment by integrating with the Windows Package Manager (Winget). Search from a curated catalog of 100+ enterprise-ready applications, and deploy them directly to your Intune tenant with automated packaging.

## Features

- **Curated App Catalog** - Browse 100+ pre-configured applications ready for Intune deployment
- **One-Click Deployment** - Deploy apps directly to your Microsoft Intune tenant
- **Automated Packaging** - Apps are automatically packaged as `.intunewin` files using GitHub Actions
- **Multi-Tenant Support** - Works with any Microsoft Entra ID tenant (multi-tenant app)
- **MSP Mode** - Managed Service Providers can manage multiple client tenants
- **Real-Time Status** - Track deployment progress with live updates via Supabase

## Quick Start

### Option 1: Use Hosted Version

Visit [intuneget.com](https://intuneget.com) to use the hosted version.

### Option 2: Self-Host with Docker

```bash
# Clone the repository
git clone https://github.com/ugurkocde/IntuneGet.git
cd IntuneGet

# Copy and configure environment variables
cp .env.example .env.local
# Edit .env.local with your configuration

# Start with Docker Compose
docker-compose up -d
```

See [Self-Hosting Guide](docs/SELF_HOSTING.md) for detailed instructions.

### Option 3: Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ugurkocde/IntuneGet)

## Architecture

```
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|   Next.js App    |---->|    Supabase      |<----|  GitHub Actions  |
|   (Frontend)     |     |   (Database)     |     |   (Packaging)    |
|                  |     |                  |     |                  |
+------------------+     +------------------+     +------------------+
        |                                                  |
        v                                                  v
+------------------+                              +------------------+
|                  |                              |                  |
|   Microsoft      |                              |   Windows Runner |
|   Entra ID       |                              |   + IntuneWin    |
|                  |                              |                  |
+------------------+                              +------------------+
```

**Components:**
- **Next.js Frontend** - React-based web application with TypeScript
- **Supabase** - PostgreSQL database with real-time subscriptions
- **Microsoft Entra ID** - Authentication via MSAL (multi-tenant)
- **GitHub Actions** - Windows runner for `.intunewin` packaging

## Security Model

IntuneGet uses a multi-repository architecture for security:

- **Source Code** (this repo) - Fully open source, transparent, and auditable
- **Workflow Execution** - Runs in a private repository to protect tenant information
- **Self-Hosting** - Use the Windows worker npm package for complete control over your data

All callbacks use HMAC-SHA256 signature verification. Tenant IDs are masked in logs and never visible in public workflow runs. See [SECURITY.md](SECURITY.md) for details.

## Documentation

| Document | Description |
|----------|-------------|
| [Self-Hosting Guide](docs/SELF_HOSTING.md) | Complete guide for self-hosting IntuneGet |
| [Azure AD Setup](docs/AZURE_AD_SETUP.md) | Configure Microsoft Entra ID app registration |
| [GitHub Actions Setup](docs/GITHUB_ACTIONS_SETUP.md) | Set up the packaging pipeline |
| [Database Setup](docs/DATABASE_SETUP.md) | Supabase configuration options |
| [Development Guide](docs/DEVELOPMENT.md) | Local development setup |

## Requirements

### For Self-Hosting
- Node.js 20+
- Supabase account (or self-hosted Supabase)
- Microsoft Entra ID tenant with admin access
- GitHub account (for packaging pipeline)

### For Development
- Node.js 20+
- npm or pnpm

## Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local
# Edit .env.local with your configuration

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Tech Stack

- **Framework**: [Next.js 14](https://nextjs.org/) with App Router
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/)
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **Authentication**: [MSAL](https://github.com/AzureAD/microsoft-authentication-library-for-js) (Microsoft Entra ID)
- **State Management**: [Zustand](https://zustand-demo.pmnd.rs/) + [TanStack Query](https://tanstack.com/query)
- **Animations**: [Framer Motion](https://www.framer.com/motion/)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE) for details.

**What this means:**
- You can self-host for internal business use
- You can modify the code for personal/internal use
- If you run a modified version as a network service, you must share your source code
- You cannot build a commercial SaaS using this code without open-sourcing your changes

## Security

Report security vulnerabilities by opening a GitHub issue or emailing security@intuneget.com.

See [SECURITY.md](SECURITY.md) for our security policy.
