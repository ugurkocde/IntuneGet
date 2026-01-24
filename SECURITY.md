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

- The service principal requires DeviceManagementApps.ReadWrite.All (broad permission)
- GitHub Actions runners have temporary access to download URLs
- Installer files are temporarily stored on runners during packaging

## Compliance

IntuneGet is designed with enterprise security in mind:
- No data leaves your control (self-hosting available)
- Full audit trail via GitHub Actions logs
- RBAC support through Intune assignments
