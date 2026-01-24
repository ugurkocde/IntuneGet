# GitHub Actions Setup

This guide covers setting up the GitHub Actions packaging pipeline for IntuneGet.

## Overview

IntuneGet uses GitHub Actions to:
1. Download applications from Winget
2. Package them as `.intunewin` files using `IntuneWinAppUtil.exe`
3. Upload the packaged app to Microsoft Intune
4. Report status back to the web application

The workflow runs on a **Windows runner** because `IntuneWinAppUtil.exe` is a Windows-only tool.

## Setup Options

### Option A: Fork the Repository (Recommended)

Best for most self-hosters. Uses GitHub's hosted runners.

1. Fork the IntuneGet repository
2. Configure secrets in your fork
3. Point your deployment to your fork

### Option B: Self-Hosted Runner

For enterprises wanting to use their own infrastructure.

1. Set up a Windows machine as a self-hosted runner
2. Register it with your repository
3. Modify workflow to use `runs-on: self-hosted`

## Fork Setup

### Step 1: Fork the Repository

1. Go to [github.com/ugurkocde/IntuneGet-Website](https://github.com/ugurkocde/IntuneGet-Website)
2. Click **Fork** in the top right
3. Select your account/organization
4. Wait for the fork to complete

### Step 2: Configure Repository Secrets

Navigate to your forked repository:
**Settings** > **Secrets and variables** > **Actions** > **New repository secret**

Add these secrets:

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `AZURE_CLIENT_ID` | Azure AD Application ID | From Azure AD app registration |
| `AZURE_CLIENT_SECRET` | Azure AD Client Secret | From Azure AD app registration |
| `CALLBACK_SECRET` | Webhook verification secret | Generate with `openssl rand -hex 16` |

### Step 3: Enable Workflows

GitHub disables workflows in forks by default:

1. Go to the **Actions** tab in your fork
2. Click **I understand my workflows, go ahead and enable them**

### Step 4: Update Your Environment

In your IntuneGet deployment, update these environment variables:

```env
GITHUB_OWNER=your-github-username
GITHUB_REPO=IntuneGet-Website
GITHUB_PAT=ghp_your-personal-access-token
CALLBACK_SECRET=same-secret-as-in-github
```

## Create Personal Access Token

The PAT allows IntuneGet to trigger workflows in your repository.

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Set a descriptive name: `IntuneGet Pipeline`
4. Select scopes:
   - `repo` (Full control of private repositories)
   - `workflow` (Update GitHub Action workflows)
5. Click **Generate token**
6. Copy the token immediately

For fine-grained tokens:
- Repository access: Select your fork
- Permissions:
  - Actions: Read and write
  - Contents: Read

## Workflow Configuration

The packaging workflow is located at `.github/workflows/package-intunewin.yml`.

### Workflow Inputs

When triggered, the workflow receives:

| Input | Description |
|-------|-------------|
| `app_id` | Winget package identifier |
| `deployment_id` | Unique deployment tracking ID |
| `tenant_id` | Target Microsoft 365 tenant |
| `callback_url` | URL to report status back |

### Workflow Secrets Used

| Secret | Purpose |
|--------|---------|
| `AZURE_CLIENT_ID` | Authenticate to Intune |
| `AZURE_CLIENT_SECRET` | Authenticate to Intune |
| `CALLBACK_SECRET` | Sign webhook callbacks |

## Self-Hosted Runner Setup

If you prefer to use your own infrastructure:

### Requirements

- Windows 10/11 or Windows Server 2019+
- PowerShell 5.1+
- At least 4GB RAM
- 20GB+ free disk space
- Internet access

### Installation

1. In your repository, go to **Settings** > **Actions** > **Runners**
2. Click **New self-hosted runner**
3. Select **Windows** and follow the instructions

### Modify Workflow

Update `.github/workflows/package-intunewin.yml`:

```yaml
jobs:
  package:
    runs-on: self-hosted  # Changed from windows-latest
```

## Testing the Pipeline

To test the pipeline manually:

1. Go to **Actions** in your fork
2. Select the **Package Intunewin** workflow
3. Click **Run workflow**
4. Fill in test values:
   - `app_id`: `Microsoft.VisualStudioCode`
   - `deployment_id`: `test-123`
   - `tenant_id`: Your test tenant
   - `callback_url`: Your deployment URL + `/api/callback`
5. Click **Run workflow**

## Monitoring

### View Workflow Runs

1. Go to **Actions** tab
2. Click on a workflow run to see details
3. Expand steps to see logs

### Common Issues

**Workflow not triggering:**
- Verify PAT has correct scopes
- Check workflow is enabled
- Verify environment variables are correct

**IntuneWinAppUtil fails:**
- Check app ID is valid
- Verify the app has a supported installer type
- Check runner has enough disk space

**Callback fails:**
- Verify `CALLBACK_SECRET` matches
- Check `NEXT_PUBLIC_URL` is accessible from GitHub
- Review callback endpoint logs

## Cost Considerations

GitHub Actions usage:
- **Public repos**: Free
- **Private repos**: 2,000 minutes/month free, then $0.008/minute for Windows

Each packaging job typically takes 2-5 minutes.

## Security Notes

1. **PAT scope**: Use minimal necessary permissions
2. **Secret rotation**: Rotate PAT and secrets periodically
3. **Fork security**: Review PRs before merging (could modify workflows)
4. **Runner security**: If self-hosting, keep runner machine updated
