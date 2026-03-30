# Authentication Architecture

This document explains how IntuneGet authenticates users and performs Intune operations.

## Components

1. User authentication (client-side): MSAL with delegated permissions.
2. Service authentication (server/packager): Azure app credentials with application permissions.
3. Consent model: tenant-level admin consent before deployment actions.

## 1. User Authentication (MSAL)

- Environment variable: `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`
- Flow: users sign in with Microsoft work accounts.
- Primary delegated scope: `User.Read`
- Token usage: identify user and tenant context in the UI/API.

## 2. Service Principal Access (Intune Operations)

- Environment variables:
  - Web app: `AZURE_AD_CLIENT_SECRET` (or `AZURE_CLIENT_SECRET`)
  - Packager/service: `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- Required application permissions:
  - `DeviceManagementApps.ReadWrite.All`
  - `DeviceManagementManagedDevices.Read.All` (for unmanaged apps)
  - `DeviceManagementServiceConfig.ReadWrite.All` (for ESP profile support)
- Purpose: create/update Intune Win32 apps and related metadata.

## 3. Admin Consent Model

Before deployments can run for a tenant, a Global Administrator must grant consent.

Consent URL format:

```text
https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}&redirect_uri={redirect-uri}
```

IntuneGet checks consent status before accepting packaging jobs.

## Packaging Security Paths

### GitHub mode

- Uses `GITHUB_WORKFLOWS_REPO` (private repository) for packaging workflow runs.
- Callback endpoint: `/api/package/callback`
- Callback signing: `CALLBACK_SECRET` (HMAC-SHA256)

### Local packager mode

- Web app uses `PACKAGER_MODE=local`.
- Packager authenticates using `PACKAGER_API_KEY`.
- Packager API endpoints:
  - `GET /api/packager/jobs`
  - `POST /api/packager/jobs` (claim)
  - `PATCH /api/packager/jobs` (progress/status)
  - `DELETE /api/packager/jobs` (release)

## Token and Secret Handling Notes

- Secrets must never be exposed to client-side code.
- Access tokens are short-lived and tenant-scoped.
- Callback signatures should be verified in all production deployments.
- Rotate Azure client secrets and PATs periodically.
