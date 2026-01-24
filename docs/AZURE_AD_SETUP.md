# Azure AD / Microsoft Entra ID Setup

This guide covers creating and configuring the Microsoft Entra ID app registration required for IntuneGet.

## Overview

IntuneGet uses a multi-tenant app registration that allows users from any Microsoft 365 organization to:
1. Sign in with their work account
2. Grant admin consent for app deployment permissions
3. Deploy applications to their Intune tenant

## Create App Registration

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Microsoft Entra ID** > **App registrations**
3. Click **New registration**

### Registration Settings

| Setting | Value |
|---------|-------|
| Name | `IntuneGet` (or your preferred name) |
| Supported account types | **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)** |
| Redirect URI (type) | **Single-page application (SPA)** |
| Redirect URI (value) | `http://localhost:3000` (development) |

4. Click **Register**

## Configure Redirect URIs

After registration, add your production redirect URI:

1. Go to **Authentication** in the left menu
2. Under **Single-page application**, click **Add URI**
3. Add your production URL: `https://your-domain.com`
4. Click **Save**

## Configure API Permissions

IntuneGet requires two types of permissions:

### Delegated Permissions (User Sign-in)

1. Go to **API permissions** in the left menu
2. Click **Add a permission**
3. Select **Microsoft Graph**
4. Select **Delegated permissions**
5. Search and add: `User.Read`
6. Click **Add permissions**

### Application Permissions (Service Principal)

1. Click **Add a permission** again
2. Select **Microsoft Graph**
3. Select **Application permissions**
4. Search and add: `DeviceManagementApps.ReadWrite.All`
5. Click **Add permissions**

Your permissions should look like this:

| Permission | Type | Status |
|------------|------|--------|
| User.Read | Delegated | Granted for your org |
| DeviceManagementApps.ReadWrite.All | Application | Requires admin consent |

## Create Client Secret

1. Go to **Certificates & secrets** in the left menu
2. Click **New client secret**
3. Add a description: `IntuneGet Production`
4. Select expiration (recommend: 24 months)
5. Click **Add**
6. **Immediately copy the secret value** - it won't be shown again

## Collect Required Values

After setup, collect these values for your environment configuration:

| Value | Location | Environment Variable |
|-------|----------|---------------------|
| Application (client) ID | Overview page | `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` |
| Client secret | Certificates & secrets | `AZURE_AD_CLIENT_SECRET` |

## Admin Consent Flow

When users from other organizations use IntuneGet, a Global Administrator from their tenant must grant consent for the application permissions.

### How it works:

1. User signs in to IntuneGet
2. IntuneGet checks if admin consent was granted
3. If not, user sees instructions to request consent
4. Global Admin visits the consent URL
5. Admin reviews and grants permissions
6. User can now deploy apps

### Admin Consent URL Format

```
https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}&redirect_uri={redirect-uri}
```

Example:
```
https://login.microsoftonline.com/contoso.onmicrosoft.com/adminconsent?client_id=12345678-1234-1234-1234-123456789abc&redirect_uri=https://intuneget.com
```

## GitHub Actions Configuration

For the packaging pipeline, you also need to configure secrets in your GitHub repository:

1. Go to your GitHub repository > **Settings** > **Secrets and variables** > **Actions**
2. Add these repository secrets:

| Secret Name | Value |
|-------------|-------|
| `AZURE_CLIENT_ID` | Same as `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` |
| `AZURE_CLIENT_SECRET` | Same as `AZURE_AD_CLIENT_SECRET` |

## Security Recommendations

1. **Rotate secrets regularly** - Set calendar reminders before expiration
2. **Use separate registrations** - Create separate apps for dev/staging/production
3. **Monitor sign-ins** - Review sign-in logs in Azure AD periodically
4. **Limit admin consent** - Educate admins about what permissions they're granting

## Troubleshooting

### "AADSTS50011: Reply URL does not match"

Your redirect URI doesn't match what's configured:
1. Check the exact URL (including trailing slashes)
2. Verify it's added as a SPA redirect, not Web

### "AADSTS65001: User or admin has not consented"

Admin consent hasn't been granted:
1. Direct the admin to the consent URL
2. Ensure they're using a Global Administrator account
3. Verify they click "Accept" on the consent screen

### "AADSTS700016: Application not found"

The client ID is incorrect or the app was deleted:
1. Verify `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` is correct
2. Check the app still exists in Azure AD

### "Invalid client secret"

The client secret is wrong or expired:
1. Check `AZURE_AD_CLIENT_SECRET` matches the secret in Azure
2. Verify the secret hasn't expired
3. Create a new secret if needed
