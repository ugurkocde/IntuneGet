# Security Policy

## Reporting Vulnerabilities

Please report security vulnerabilities by:
1. Opening a GitHub issue (for non-sensitive issues)
2. Emailing security@intuneget.com (for sensitive issues)

We will respond within 48 hours and work with you to understand and resolve the issue.

## Security Architecture

### Multi-Repository Architecture

IntuneGet uses a split-repository architecture for security:

- **IntuneGet** (Public) - Source code, documentation, and public CI/CD workflows
- **IntuneGet-Workflows** (Private) - Packaging workflow that handles tenant data

This separation ensures that:
- Tenant IDs are never visible in public workflow runs
- Deployment details remain private
- Source code is fully transparent and auditable

### Authentication

- **User Authentication**: Microsoft Entra ID (MSAL) with delegated permissions
- **Service Principal**: Application permissions for Intune API access
- **Admin Consent**: Required one-time setup per tenant

### Secrets Management

- Secrets are stored in GitHub Secrets (never in code)
- Azure credentials are stored in the private workflows repository
- HMAC-SHA256 signature verification for all callbacks

### Data Protection

- All data in transit uses TLS 1.2+
- Tenant IDs are masked in logs using GitHub's `::add-mask::` feature
- No sensitive data is stored permanently (jobs are ephemeral)

### Data Residency (Hosted Version)

The hosted service at intuneget.com stores its data in the European Union:

- **Database**: Supabase, Frankfurt, Germany region (`eu-central-1`). Stores only operational metadata (account email, deployment history, app catalog, team/organization settings, audit logs).
- **Application/compute**: Served over TLS via Vercel's global edge network.
- **Packaging**: Runs on ephemeral GitHub-hosted runners; installer files are downloaded only during packaging and discarded afterward.
- **Not stored**: Application installers and Intune credentials. Authentication uses Microsoft Entra ID, access tokens remain in the browser session, and packaged apps are uploaded directly to your own Intune tenant.

Self-hosting is available for organizations that require data to remain entirely within their own infrastructure or a specific region.

## Security Best Practices

When self-hosting IntuneGet:

1. **Use strong secrets**: Generate all secrets with `openssl rand -hex 32`
2. **Restrict PAT scopes**: Only grant necessary GitHub permissions
3. **Enable audit logging**: Monitor Intune and Azure AD sign-in logs
4. **Regular rotation**: Rotate Azure client secrets periodically
5. **Network security**: Use private endpoints where possible

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | Yes                |
| < Latest| Security fixes only|

## Known Limitations

- The service principal requires DeviceManagementApps.ReadWrite.All and DeviceManagementServiceConfig.ReadWrite.All (broad permissions)
- GitHub Actions runners have temporary access to download URLs
- Installer files are temporarily stored on runners during packaging

## Compliance

IntuneGet is designed with enterprise security in mind:
- No data leaves your control (self-hosting available)
- Full audit trail via GitHub Actions logs
- RBAC support through Intune assignments
