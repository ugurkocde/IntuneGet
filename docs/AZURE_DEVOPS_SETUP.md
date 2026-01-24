# Azure DevOps Packaging Pipeline Setup

This guide walks you through setting up the Azure DevOps pipeline that creates `.intunewin` packages from Winget installers.

## Architecture Overview

```
[IntuneGet Web App]
      |
      | 1. User clicks "Deploy to Intune"
      v
[API: /api/package]
      |
      | 2. Trigger Azure DevOps Pipeline via REST API
      v
[Azure DevOps Pipeline (Windows Agent)]
  - Downloads installer from Winget URL
  - Wraps with PSADT (PowerShell App Deployment Toolkit)
  - Runs IntuneWinAppUtil.exe to create .intunewin
  - Uploads package to Azure Blob Storage
  - Sends callback to web app
      |
      | 3. Callback with results
      v
[Web App: /api/package/callback]
      |
      | 4. User uploads to Intune
      v
[Microsoft Intune]
```

## Prerequisites

- Azure subscription (for Storage Account)
- Azure DevOps organization (free tier works)
- Azure CLI installed locally

## Step 1: Deploy Azure Storage

The pipeline needs Azure Blob Storage to store the generated `.intunewin` packages.

### Using Azure CLI

```bash
# Login to Azure
az login

# Create resource group
az group create --name rg-intuneget --location eastus

# Deploy the Bicep template
cd infrastructure
az deployment group create \
  --resource-group rg-intuneget \
  --template-file main.bicep \
  --parameters environment=prod webAppCallbackUrl=https://your-domain.com

# Get the outputs
az deployment group show \
  --resource-group rg-intuneget \
  --name main \
  --query properties.outputs
```

Save the `storageAccountName` and `storageConnectionString` from the outputs.

### Manual Setup (Alternative)

1. Go to Azure Portal > Storage accounts > Create
2. Settings:
   - Name: `intunegetstorage` (must be globally unique)
   - Region: Same as your users
   - Performance: Standard
   - Redundancy: LRS (Locally-redundant storage)
3. Create two containers:
   - `intunewin-packages` (for output packages)
   - `installers-temp` (for temporary installer storage)

## Step 2: Create Azure DevOps Organization & Project

### 2.1 Create Organization (if needed)

1. Go to [dev.azure.com](https://dev.azure.com)
2. Sign in with your Microsoft account
3. Click "New organization"
4. Name it (e.g., `your-company-intune`)

### 2.2 Create Project

1. Click "New project"
2. Settings:
   - Name: `IntuneGet`
   - Visibility: Private
   - Version control: Git
   - Work item process: Basic

## Step 3: Create Service Connection to Azure

The pipeline needs access to your Azure subscription to upload files to Blob Storage.

1. In Azure DevOps, go to **Project Settings** (bottom left)
2. Select **Service connections** under Pipelines
3. Click **New service connection**
4. Choose **Azure Resource Manager**
5. Select **Service principal (automatic)**
6. Configure:
   - Scope level: Subscription
   - Subscription: Select your Azure subscription
   - Resource group: `rg-intuneget`
   - Service connection name: `AzureServiceConnection`
7. Check "Grant access permission to all pipelines"
8. Click **Save**

## Step 4: Create Pipeline Variables

1. In Azure DevOps, go to **Pipelines** > **Library**
2. Click **+ Variable group**
3. Name: `IntuneGet-Variables`
4. Add variables:

| Variable | Value | Secret? |
|----------|-------|---------|
| `AzureStorageAccount` | Your storage account name | No |
| `AzureServiceConnection` | `AzureServiceConnection` | No |

5. Click **Save**

## Step 5: Create the Pipeline

### 5.1 Import the Pipeline YAML

1. In Azure DevOps, go to **Pipelines** > **Pipelines**
2. Click **New pipeline**
3. Select **Azure Repos Git** (or GitHub if you host there)
4. If using GitHub:
   - Click "GitHub" and authorize Azure DevOps
   - Select your repository
5. Select **Existing Azure Pipelines YAML file**
6. Path: `/.azuredevops/packaging-pipeline.yml`
7. Click **Continue**
8. Review the pipeline, then click **Save** (not "Run")

### 5.2 Link Variable Group

1. Edit the pipeline
2. Click **Variables** > **Variable groups**
3. Link the `IntuneGet-Variables` group
4. Save

### 5.3 Get Pipeline ID

After saving, note the pipeline ID from the URL:
```
https://dev.azure.com/{org}/{project}/_build?definitionId=123
                                                         ^^^
                                                     Pipeline ID
```

## Step 6: Create Personal Access Token (PAT)

The web app needs a PAT to trigger pipelines via REST API.

1. In Azure DevOps, click your profile icon (top right)
2. Select **Personal access tokens**
3. Click **New Token**
4. Configure:
   - Name: `IntuneGet-Pipeline-Trigger`
   - Organization: Your organization
   - Expiration: Custom (set to 1 year or as needed)
   - Scopes: Custom defined, then select:
     - **Build**: Read & execute
     - **Project and Team**: Read
5. Click **Create**
6. **IMPORTANT**: Copy the token now - you won't see it again!

## Step 7: Configure Web App Environment Variables

Add these to your `.env.local`:

```env
# Azure DevOps
AZURE_DEVOPS_ORGANIZATION=your-organization
AZURE_DEVOPS_PROJECT=IntuneGet
AZURE_DEVOPS_PIPELINE_ID=123  # From Step 5.3
AZURE_DEVOPS_PAT=your-pat-token  # From Step 6

# Azure Storage
AZURE_STORAGE_ACCOUNT_NAME=your-storage-account

# Callback URL
NEXT_PUBLIC_URL=https://your-domain.com
```

## Step 8: Run Supabase Migration

Apply the database migration for job tracking:

```bash
# Using Supabase CLI
supabase db push

# Or manually in Supabase Dashboard:
# SQL Editor > New query > Paste contents of supabase/migrations/001_packaging_jobs.sql
```

## Step 9: Test the Pipeline

### Manual Test

1. In Azure DevOps, go to your pipeline
2. Click **Run pipeline**
3. Fill in the parameters:
   - `jobId`: `test-123`
   - `callbackUrl`: `https://your-domain.com/api/package/callback`
   - `wingetId`: `7zip.7zip`
   - `displayName`: `7-Zip`
   - `publisher`: `Igor Pavlov`
   - `version`: `24.08`
   - `installerUrl`: `https://www.7-zip.org/a/7z2408-x64.exe`
   - `installerSha256`: `...` (get from Winget manifest)
   - `installerType`: `exe`
   - `silentSwitches`: `/S`
   - `uninstallCommand`: `"C:\Program Files\7-Zip\Uninstall.exe" /S`
   - `installScope`: `machine`
4. Click **Run**
5. Monitor the pipeline execution
6. Verify `.intunewin` file appears in your blob storage

### End-to-End Test

1. Go to your IntuneGet web app
2. Search for "7-Zip" in the App Catalog
3. Configure the package and add to cart
4. Click "Deploy to Intune"
5. Monitor progress on the Uploads page
6. Verify the pipeline runs in Azure DevOps

## Troubleshooting

### Pipeline fails at "Upload to Azure Blob Storage"

- Verify the Service Connection has access to the storage account
- Check the storage account name in pipeline variables

### Callback not received

- Ensure `NEXT_PUBLIC_URL` is publicly accessible
- Check if your firewall allows incoming requests from Azure DevOps IPs
- Verify the callback endpoint is working: `curl https://your-domain.com/api/package/callback`

### "Failed to trigger pipeline" error

- Verify PAT has correct scopes
- Ensure PAT is not expired
- Check organization and project names are correct

### Installer download fails

- Some installers require user-agent headers
- The URL might be behind a CDN that blocks automated downloads
- Try downloading manually to verify the URL works

## Security Considerations

1. **PAT Token**: Store securely, rotate periodically
2. **Service Connection**: Uses least-privilege principle
3. **Blob Storage**: Private access only, SAS tokens for temp access
4. **Callback Secret**: Add `PACKAGE_CALLBACK_SECRET` for production

## Cost Estimate

| Resource | Cost |
|----------|------|
| Azure DevOps | Free (1800 mins/month of Windows agents) |
| Azure Storage | ~$0.02/GB/month |
| **Total** | Effectively free for moderate usage |

## Next Steps

- Set up production environment with separate storage account
- Configure alerts for failed pipelines
- Add retry logic for transient failures
- Implement automatic Intune upload after packaging completes
