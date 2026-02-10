# Environment Variable Reference

This document consolidates environment variables across web app and packager modes.

## Quick Mode Matrix

| Mode | Required Core |
|---|---|
| Supabase + GitHub | `DATABASE_MODE=supabase`, Supabase vars, Azure vars, GitHub vars, `NEXT_PUBLIC_URL` |
| Supabase + Local Packager | `DATABASE_MODE=supabase`, Supabase vars incl. service role, Azure vars, `PACKAGER_MODE=local` |
| SQLite + Local Packager | `DATABASE_MODE=sqlite`, `PACKAGER_API_KEY`, Azure vars, `PACKAGER_MODE=local` |

## Web App Variables

### Core

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` | Yes | Entra app client ID |
| `AZURE_AD_CLIENT_SECRET` | Yes* | Server-side secret (`AZURE_CLIENT_SECRET` also supported) |
| `NEXT_PUBLIC_URL` | Yes | Public URL for callbacks/links |
| `PACKAGER_MODE` | Yes | `github` or `local` |
| `DATABASE_MODE` | Yes | `supabase` or `sqlite` |

### Database

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required in `supabase` mode | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required in `supabase` mode | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Required for server operations in `supabase` mode | Privileged key |
| `DATABASE_PATH` | Optional in `sqlite` mode | Default `./data/intuneget.db` |
| `PACKAGER_API_KEY` | Required in `sqlite + local` mode | Shared key for packager API auth |

### GitHub Packaging Mode

| Variable | Required in `PACKAGER_MODE=github` | Notes |
|---|---|---|
| `GITHUB_PAT` | Yes | PAT to dispatch/check workflow runs |
| `GITHUB_OWNER` | Yes | User/org owner |
| `GITHUB_WORKFLOWS_REPO` | Yes | Private workflow repository |
| `GITHUB_REPO` | Optional | Public repo reference |
| `GITHUB_WORKFLOW_FILE` | Optional | Default `package-intunewin.yml` |
| `GITHUB_REF` | Optional | Default `main` |
| `CALLBACK_SECRET` | Recommended | HMAC verification for callback endpoint |

### Optional Integrations

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Optional | Enables analytics tracking |
| `BEEHIIV_API_KEY` | Optional | Newsletter integration |
| `RESEND_API_KEY` | Optional | Email sending |
| `RESEND_FROM_EMAIL` | Optional | Email sender address |

### Runtime/Platform

| Variable | Source |
|---|---|
| `VERCEL` | Platform |
| `VERCEL_URL` | Platform |
| `NODE_ENV` | Runtime |
| `DEPLOYMENT_MODE` | Optional override |

### Security/Operations

| Variable | Notes |
|---|---|
| `CRON_SECRET` | Protect cron routes |
| `MSP_STATE_SECRET` | MSP state/signing support |

## Packager Service Variables

Packager binary (`@ugurkocde/intuneget-packager`) supports two communication modes.

### Common Required

| Variable | Required | Notes |
|---|---|---|
| `AZURE_CLIENT_ID` | Yes | Service principal client ID |
| `AZURE_CLIENT_SECRET` | Yes | Service principal client secret |

### API Mode (recommended with sqlite web mode)

| Variable | Required | Notes |
|---|---|---|
| `INTUNEGET_API_URL` | Yes | Base URL of web app |
| `PACKAGER_API_KEY` | Yes | Must match web app key |

### Supabase Mode

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key |

### Packager Optional

| Variable | Default | Notes |
|---|---|---|
| `PACKAGER_ID` | auto-generated | Instance identity |
| `POLL_INTERVAL` | `5000` | ms between polling cycles |
| `STALE_JOB_TIMEOUT` | `300000` | stale job threshold ms |
| `WORK_DIR` | `./work` | packaging working dir |
| `TOOLS_DIR` | `./tools` | IntuneWinAppUtil + PSADT path |
| `AZURE_TENANT_ID` | none | optional default tenant hint |

## Naming Compatibility

The web app supports both:

- `AZURE_AD_CLIENT_SECRET`
- `AZURE_CLIENT_SECRET`

For consistency, prefer `AZURE_AD_CLIENT_SECRET` in web app config and `AZURE_CLIENT_SECRET` where integrations expect that name (for example workflow secrets and packager).

## Docker Runtime Injection

Next.js inlines `NEXT_PUBLIC_*` variables at build time, which means they are
empty in a pre-built Docker image. IntuneGet includes a runtime injection layer
(`lib/runtime-config.ts` + `layout.tsx`) that reads `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`
from the server process at request time and forwards it to the browser via
`window.__RUNTIME_CONFIG__`.

What this means for operators:

- **No build arguments needed.** Pass `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` in the
  container `environment` section of `docker-compose.yml` and it will be
  available to the client automatically.
- **Vercel and local dev are unaffected.** The standard build-time inlining
  still works; the runtime layer is a transparent fallback.
- Other `NEXT_PUBLIC_*` variables (Supabase URL, Plausible domain, etc.) are
  currently only used in server components or server-side API routes, so they
  are read from `process.env` at runtime and do not require this injection.

## Validation Tips

1. In sqlite + local mode, missing `PACKAGER_API_KEY` is the most common failure.
2. In github mode, missing `GITHUB_WORKFLOWS_REPO` prevents workflow dispatch.
3. In supabase mode, missing `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` prevents app data access.
4. Keep secrets out of client-exposed variables unless explicitly `NEXT_PUBLIC_*` and intended.
5. In Docker deployments, if MSAL authentication URLs are missing the `client_id`
   parameter, verify that `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` is set in the
   container environment (not only in a `.env` file on the host).
