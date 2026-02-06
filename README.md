<div align="center">

<img src="public/logo-512.png" alt="IntuneGet Logo" width="120" height="120" />

# IntuneGet

**Deploy Winget applications to Microsoft Intune with a single click.**

Skip the manual packaging workflow and deploy Winget apps to Intune in seconds.

**10,000+ Winget apps** | **One-click deployment** | **Multi-tenant support** | **Free and open source**

[![CI](https://img.shields.io/github/actions/workflow/status/ugurkocde/IntuneGet/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/ugurkocde/IntuneGet/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/github/actions/workflow/status/ugurkocde/IntuneGet/ci.yml?branch=main&style=flat-square&label=Tests)](https://github.com/ugurkocde/IntuneGet/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/github/actions/workflow/status/ugurkocde/IntuneGet/ci.yml?branch=main&style=flat-square&label=Docker&logo=docker)](https://github.com/ugurkocde/IntuneGet/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)
[![Release](https://img.shields.io/github/v/release/ugurkocde/IntuneGet?style=flat-square)](https://github.com/ugurkocde/IntuneGet/releases)
[![Stars](https://img.shields.io/github/stars/ugurkocde/IntuneGet?style=flat-square)](https://github.com/ugurkocde/IntuneGet/stargazers)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)

[![Get Started](https://img.shields.io/badge/Get_Started-intuneget.com-2563eb?style=for-the-badge)](https://intuneget.com)
[![Documentation](https://img.shields.io/badge/Documentation-Self--Hosting-555555?style=for-the-badge)](docs/SELF_HOSTING.md)
[![Contributing](https://img.shields.io/badge/Contributing-Guide-555555?style=for-the-badge)](CONTRIBUTING.md)

</div>

---

<div align="center">

**[Features](#features)** | **[Quick Start](#quick-start)** | **[Architecture](#architecture)** | **[How It Compares](#how-it-compares)** | **[Documentation](#documentation)**

</div>

---

## Features

### For IT Admins

- **Curated App Catalog** - Browse 10,000+ applications from the Winget repository, ready for Intune deployment
- **One-Click Deployment** - Deploy apps directly to your Microsoft Intune tenant
- **Real-Time Status** - Track deployment progress with live updates
- **Pre-Configured Detection Rules** - Skip the manual configuration
- **Community Ratings** - See how other admins rate apps before deploying
- **App Suggestions** - Suggest and vote on new apps for the catalog
- **In-App Notifications** - Get notified about deployment status, app updates, and community activity
- **PSADT v4 Support** - Deploy apps with PowerShell App Deployment Toolkit v4 UI elements (dialogs, balloon tips, process handling)

### For Managed Service Providers

- **Multi-Tenant Support** - Works with any Microsoft Entra ID tenant
- **MSP Mode** - Manage multiple client tenants from a single interface
- **Tenant Isolation** - Each client's data remains completely separate
- **Batch Deployments** - Deploy a single app across multiple tenants simultaneously with configurable concurrency
- **Team Management** - Invite members, assign roles (Owner, Admin, Operator, Viewer), manage access with role-based permissions
- **Webhook Integrations** - Configure event-driven webhooks for Slack, Teams, Discord, or custom endpoints with delivery logging and retry
- **Audit Logging** - Comprehensive audit trail with IP/user agent tracking and a dedicated log viewer
- **Advanced Reporting** - Cross-tenant deployment trends, success rate analytics, export to CSV/JSON/PDF

### For Self-Hosters

- **Multiple Database Options** - Supabase Cloud, self-hosted Supabase, or SQLite
- **Flexible Packaging** - GitHub Actions or local Windows packager
- **Air-Gapped Support** - Run entirely on-premises with no external dependencies
- **Full Source Access** - Audit, modify, and extend as needed

---

## Quick Start

<div align="center">

[![Try Hosted](https://img.shields.io/badge/Try_Hosted-intuneget.com-2563eb?style=for-the-badge)](https://intuneget.com)
[![Self--Host](https://img.shields.io/badge/Self--Host-Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](docs/SELF_HOSTING.md)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https://github.com/ugurkocde/IntuneGet)

</div>

### Hosted Version (Recommended)

The fastest way to get started:

<div align="center">

[![Try IntuneGet](https://img.shields.io/badge/Try_IntuneGet-intuneget.com-blue?style=for-the-badge)](https://intuneget.com)

</div>

### Self-Host with Docker

```bash
git clone https://github.com/ugurkocde/IntuneGet.git
cd IntuneGet
cp .env.example .env.local
# Edit .env.local with your configuration
docker-compose up -d
```

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ugurkocde/IntuneGet)

See the [Self-Hosting Guide](docs/SELF_HOSTING.md) for detailed instructions.

---

## Architecture

```mermaid
flowchart TB
    subgraph Frontend
        A[Next.js App]
    end

    subgraph Auth
        B[Microsoft Entra ID]
    end

    subgraph Backend
        C[Supabase]
        D[(PostgreSQL)]
        I[Notifications]
    end

    subgraph Packaging
        E[GitHub Actions]
        F[Windows Runner]
        G[IntuneWin Tool]
    end

    subgraph Microsoft
        H[Intune API]
    end

    subgraph External
        J[Webhooks - Slack/Teams/Discord]
    end

    A -->|MSAL Auth| B
    A -->|Real-time Updates| C
    C --- D
    I --- D
    I -->|Deliver| J
    A -->|Trigger Workflow| E
    E --> F
    F --> G
    G -->|Upload Package| H
    A -->|Deploy App| H
```

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | Next.js 14, React, TypeScript | Web application and UI |
| Database | Supabase (PostgreSQL) | App catalog, deployment status, real-time subscriptions |
| Authentication | MSAL | Microsoft Entra ID integration (multi-tenant) |
| Packaging | GitHub Actions | Windows runner for .intunewin file generation |
| Deployment | Intune Graph API | Application deployment to tenants |
| Notifications | In-app, Email, Webhooks | Deployment events, community updates, team activity |
| Community | Ratings, Suggestions, Voting | Community-driven app catalog feedback |

---

<details>
<summary><h2>Self-Hosting Options</h2></summary>

IntuneGet is designed for flexibility. Choose the deployment model that fits your organization.

### Deployment Options

| Option | Best For | Complexity |
|--------|----------|------------|
| **Docker Compose** | Production self-hosting | Low |
| **Vercel** | Quick deployment, serverless | Low |
| **Full Self-Hosted** | Air-gapped environments, maximum control | Medium |

### Database Options

| Option | Description | Use Case |
|--------|-------------|----------|
| **Supabase Cloud** | Managed PostgreSQL with real-time | Fastest setup, hosted version |
| **Self-Hosted Supabase** | Full Supabase stack on your infrastructure | Enterprise, compliance requirements |
| **SQLite** | Single-file database | Development, small deployments |

### Packaging Options

| Option | Description | Use Case |
|--------|-------------|----------|
| **GitHub Actions** | Cloud-based Windows runner | Default, no infrastructure needed |
| **Local Packager** | npm package for on-premises | Air-gapped, compliance requirements |

See [Database Setup](docs/DATABASE_SETUP.md) and [GitHub Actions Setup](docs/GITHUB_ACTIONS_SETUP.md) for configuration details.

</details>

<details>
<summary><h2>Security</h2></summary>

IntuneGet is built with security as a core principle.

### Multi-Repository Design

- **Source Code** (this repo) - Fully open source, transparent, and auditable
- **Workflow Execution** - Runs in a private repository to protect tenant information
- **Tenant Isolation** - Tenant IDs are masked in logs and never visible in public workflow runs

### Data Handling

- **No Data Storage** - IntuneGet does not store your application binaries or tenant credentials
- **HMAC-SHA256 Verification** - All callbacks are cryptographically signed
- **Token Handling** - Access tokens are never persisted and expire after use
- **Rate Limiting** - API endpoints are protected by rate limiting
- **Role-Based Access Control** - MSP features use granular permissions with four role levels (Owner, Admin, Operator, Viewer)

### Audit Logging

- All MSP operations are logged with IP address, user agent, and timestamp
- Dedicated log viewer for reviewing team and deployment activity

### Air-Gapped Support

For organizations with strict compliance requirements:
- Run the local packager on your own Windows infrastructure
- Use self-hosted Supabase or SQLite
- No external network calls required

See [SECURITY.md](SECURITY.md) for our complete security policy.

</details>

<details>
<summary><h2>Tech Stack</h2></summary>

| Category | Technology |
|----------|------------|
| **Frontend** | [Next.js 14](https://nextjs.org/) with App Router |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **UI Components** | [shadcn/ui](https://ui.shadcn.com/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) |
| **Database** | [Supabase](https://supabase.com/) (PostgreSQL) |
| **Authentication** | [MSAL](https://github.com/AzureAD/microsoft-authentication-library-for-js) (Microsoft Entra ID) |
| **State Management** | [Zustand](https://zustand-demo.pmnd.rs/) + [TanStack Query](https://tanstack.com/query) |
| **Animations** | [Framer Motion](https://www.framer.com/motion/) |
| **Deployment** | [Vercel](https://vercel.com/), Docker |

</details>

---

## Documentation

| Document | Description |
|----------|-------------|
| [Self-Hosting Guide](docs/SELF_HOSTING.md) | Complete guide for self-hosting IntuneGet |
| [Azure AD Setup](docs/AZURE_AD_SETUP.md) | Configure Microsoft Entra ID app registration |
| [GitHub Actions Setup](docs/GITHUB_ACTIONS_SETUP.md) | Set up the packaging pipeline |
| [Database Setup](docs/DATABASE_SETUP.md) | Supabase configuration options |
| [Development Guide](docs/DEVELOPMENT.md) | Local development setup |

---

## How It Compares

| Capability | Traditional | IntuneGet |
|:-----------|:----------:|:---------:|
| **Curated app catalog** | -- | Yes |
| **One-click deployment** | -- | Yes |
| **Automated cloud packaging** | -- | Yes |
| **Pre-configured detection rules** | -- | Yes |
| **Direct deployment to tenant** | -- | Yes |
| **Multi-app batch deploy** | -- | Yes |
| **Multi-tenant batch deployment** | -- | Yes |
| **Role-based team management** | -- | Yes |
| **Community ratings and suggestions** | -- | Yes |
| **Webhook notifications** | -- | Yes |
| **Self-hosting support** | -- | Yes |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).

This license applies to all code in this repository, regardless of when it was committed.

- Self-host for internal business use
- Modify for personal or internal use
- Network service modifications must be open-sourced

---

<div align="center">

**Simplify your Intune deployments.**

[![Get Started](https://img.shields.io/badge/Get_Started-intuneget.com-2563eb?style=for-the-badge)](https://intuneget.com)
[![Documentation](https://img.shields.io/badge/Documentation-Self--Hosting-555555?style=for-the-badge)](docs/SELF_HOSTING.md)
[![Report Issue](https://img.shields.io/badge/Report-Issue-d73a49?style=for-the-badge)](https://github.com/ugurkocde/IntuneGet/issues)

[![Star on GitHub](https://img.shields.io/github/stars/ugurkocde/IntuneGet?style=social)](https://github.com/ugurkocde/IntuneGet/stargazers)

</div>
