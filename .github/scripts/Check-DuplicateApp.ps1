<#
.SYNOPSIS
    Checks for duplicate Win32 apps in Intune before creating a new one.

.DESCRIPTION
    Queries the Microsoft Graph API for existing Win32 apps matching by displayName
    and wingetId. If a duplicate is found, sends a duplicate_skipped callback and sets
    DUPLICATE_FOUND=true in the environment. If forceCreate is enabled, skips the check.

    API errors stop the deployment before app creation so a transient duplicate
    check failure cannot create a second app. Requests go through
    Invoke-GraphRequest so a genuinely transient 401/429/5xx is retried (and the
    token refreshed) before the run is failed.

.NOTES
    Env vars consumed:
      INPUT_DISPLAY_NAME, INPUT_WINGET_ID, INPUT_FORCE_CREATE,
      GRAPH_TOKEN, JOB_ID, CALLBACK_URL, CALLBACK_SECRET

    Env vars set:
      DUPLICATE_FOUND, DUPLICATE_APP_ID, DUPLICATE_APP_URL, DUPLICATE_MATCH_TYPE
#>

# Load Send-Callback helper
. "$env:GITHUB_WORKSPACE\Send-Callback.ps1"

# Graph helpers. Invoke-GraphRequest owns token refresh on 401, Retry-After on
# 429 and backoff on 5xx; calling Invoke-RestMethod directly here meant a single
# transient response failed the whole deployment.
. "$env:GITHUB_WORKSPACE\Get-GraphToken.ps1"
. "$env:GITHUB_WORKSPACE\Invoke-GraphRequest.ps1"

# If forceCreate is enabled, skip the duplicate check entirely
if ($env:INPUT_FORCE_CREATE -eq 'true') {
    Write-Host "Force create enabled, skipping duplicate check"
    echo "DUPLICATE_FOUND=false" >> $env:GITHUB_ENV
    exit 0
}

$displayName = $env:INPUT_DISPLAY_NAME
$wingetId = $env:INPUT_WINGET_ID
$graphToken = $env:GRAPH_TOKEN

if (-not $displayName) {
    Write-Host "::warning::No display name provided, skipping duplicate check"
    echo "DUPLICATE_FOUND=false" >> $env:GITHUB_ENV
    exit 0
}

if (-not $graphToken) {
    Write-Host "::warning::No Graph token available, skipping duplicate check"
    echo "DUPLICATE_FOUND=false" >> $env:GITHUB_ENV
    exit 0
}

Write-Host "Checking for duplicate app: '$displayName' (Winget: $wingetId)"

try {
    # Keep the collection projection limited to mobileApp base properties.
    # Graph rejects Win32-only fields in $select against this base collection.
    $select = "id,displayName,description"
    $baseUrl = "https://graph.microsoft.com/v1.0/deviceAppManagement/mobileApps"
    $escapedDisplayName = $displayName.Replace("'", "''")

    # Pull only the candidates that can possibly match. Enumerating every Win32
    # app in the tenant page by page is what produced 504 Gateway Timeout on
    # large tenants; the name filter usually reduces this to a single page.
    $typeFilter = "isof('microsoft.graph.win32LobApp')"
    $nameFilter = "displayName eq '${escapedDisplayName}'"
    $maxPages = 200

    function Get-CandidateApps {
        param([string]$Filter)

        $apps = @()
        $pageCount = 0
        $url = "${baseUrl}?`$filter=$([Uri]::EscapeDataString($Filter))&`$select=${select}&`$top=999"
        while ($url -and $pageCount -lt $maxPages) {
            $pageCount++
            $response = Invoke-GraphRequest -Uri $url -MaxRetries 4
            if ($response.value) { $apps += $response.value }
            $url = $response.'@odata.nextLink'
        }
        if ($url) {
            throw "Duplicate check stopped after $maxPages pages without reaching the end of the app list"
        }
        return , $apps
    }

    # Intune's $filter support on this collection is uneven, and some tenants
    # reject the isof() cast filter outright with 400 (observed Aug 2026 across
    # a whole tenant batch). Try progressively simpler query shapes before
    # failing a deployment over a query-shape limitation. The name-only shape
    # can return non-Win32 apps; the detail fetch below verifies the type
    # before an app can count as a duplicate.
    $candidateFilters = @(
        "$typeFilter and $nameFilter",
        $nameFilter,
        $typeFilter
    )
    $allApps = $null
    foreach ($candidateFilter in $candidateFilters) {
        try {
            $allApps = Get-CandidateApps -Filter $candidateFilter
            Write-Host "Found $($allApps.Count) candidate app(s) using filter [$candidateFilter]"
            break
        }
        catch {
            $filterStatus = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            if ($filterStatus -ne 400) { throw }
            # "Request not applicable to target tenant" means Intune itself is
            # not usable in this tenant (no Intune license or MDM authority not
            # set). Every deviceAppManagement request fails the same way, so
            # trying simpler query shapes is pointless.
            if ([string]$_.ErrorDetails.Message -match 'not applicable to target tenant') { throw }
            if ($candidateFilter -eq $candidateFilters[-1]) { throw }
            Write-Host "::warning::Graph rejected duplicate-check filter [$candidateFilter]; trying a simpler query shape"
        }
    }

    $nameMatches = @($allApps | Where-Object { $_.displayName -ieq $displayName })

    if ($nameMatches.Count -eq 0) {
        Write-Host "No apps found with name '$displayName' - proceeding with deployment"
        echo "DUPLICATE_FOUND=false" >> $env:GITHUB_ENV
        exit 0
    }

    Write-Host "Found $($nameMatches.Count) app(s) matching name '$displayName'"

    # Check for exact match: name + IntuneGet fingerprint in description.
    # Apps deployed with a default description carry "Winget: <id>"; apps
    # deployed with a catalog description carry only "Source: IntuneGet.com".
    # A marker naming a DIFFERENT winget id is a different app, not a duplicate.
    $exactMatch = $null
    foreach ($app in $nameMatches) {
        if (-not $app.description) { continue }
        $isFingerprintMatch = $false
        if ($app.description -match "Winget:\s*(\S+)") {
            if ($wingetId -and $Matches[1] -ieq $wingetId) {
                $isFingerprintMatch = $true
            }
        } elseif ($app.description -match [regex]::Escape("Source: IntuneGet.com")) {
            $isFingerprintMatch = $true
        }

        if (-not $isFingerprintMatch) { continue }

        # Fetch the polymorphic resource without $select before reading
        # Win32-only properties such as displayVersion and committedContentVersion.
        $detailUrl = "$baseUrl/$($app.id)"
        $appDetails = Invoke-GraphRequest -Uri $detailUrl -MaxRetries 3

        # The name-only filter shape can surface Store or LOB apps that share a
        # display name. Only a Win32 app can be a duplicate of this deployment.
        if ($appDetails.'@odata.type' -ne '#microsoft.graph.win32LobApp') {
            Write-Host "Ignoring non-Win32 app $($app.id) with matching name (type: $($appDetails.'@odata.type'))"
            continue
        }

        # Only committed, published apps are deployable duplicates. Failed or
        # partially-created apps from an earlier upload must not block a safe retry.
        if ($appDetails.publishingState -ne 'published' -or
            [string]::IsNullOrWhiteSpace([string]$appDetails.committedContentVersion)) {
            Write-Host "Ignoring incomplete matching app $($app.id) (state: $($appDetails.publishingState))"
            continue
        }

        $exactMatch = $appDetails
        break
    }

    if ($exactMatch) {
        # Exact match found (same name + same winget ID = deployed by IntuneGet)
        $appId = $exactMatch.id
        $appUrl = "https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/$appId"
        $existingVersion = $exactMatch.displayVersion

        Write-Host "::warning::Duplicate found - exact match: '$displayName' (ID: $appId, Version: $existingVersion)"

        echo "DUPLICATE_FOUND=true" >> $env:GITHUB_ENV
        echo "DUPLICATE_APP_ID=$appId" >> $env:GITHUB_ENV
        echo "DUPLICATE_APP_URL=$appUrl" >> $env:GITHUB_ENV
        echo "DUPLICATE_MATCH_TYPE=exact" >> $env:GITHUB_ENV

        # Send duplicate_skipped callback
        Send-Callback -Body @{
            jobId         = $env:JOB_ID
            status        = "duplicate_skipped"
            message       = "Duplicate app already exists in Intune"
            progress      = 100
            intuneAppId   = $appId
            intuneAppUrl  = $appUrl
            duplicateInfo = @{
                matchType       = "exact"
                existingAppId   = $appId
                existingVersion = $existingVersion
                createdAt       = $exactMatch.createdDateTime
            }
            runId  = "$env:GITHUB_RUN_ID"
            runUrl = "$env:GITHUB_SERVER_URL/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
        } -CallbackUrl $env:CALLBACK_URL -CallbackSecret $env:CALLBACK_SECRET -MaxRetries 3 | Out-Null

        Write-Host "Duplicate callback sent, skipping deployment"
        exit 0
    }
    else {
        # Partial match: same name but different source (not deployed by IntuneGet)
        Write-Host "::warning::App with name '$displayName' exists but was not deployed by IntuneGet - proceeding with deployment"
        echo "DUPLICATE_FOUND=false" >> $env:GITHUB_ENV
        echo "DUPLICATE_MATCH_TYPE=partial" >> $env:GITHUB_ENV
        exit 0
    }
}
catch {
    $errorMessage = $_.Exception.Message
    $errorBody = [string]$_.ErrorDetails.Message
    # Intune's signature error for a tenant where Intune is not usable at all
    # (no Intune license or MDM authority never set). Retrying cannot succeed,
    # so tell the customer what to fix instead of blaming Graph availability.
    $tenantNotProvisioned = $errorBody -match 'not applicable to target tenant'
    Write-Host "::error::Duplicate check failed: $errorMessage"
    Send-Callback -Body @{
        jobId = $env:JOB_ID
        status = "failed"
        message = if ($tenantNotProvisioned) {
            "Microsoft Intune does not appear to be set up in this tenant. Confirm the tenant has an Intune license and the MDM authority is set to Intune, then deploy again."
        } else {
            "Could not verify whether this app already exists in Intune. Retry when Microsoft Graph is available."
        }
        progress = 0
        errorStage = "upload"
        errorCategory = if ($tenantNotProvisioned) { "tenant_config" } else { "intune_api" }
        errorCode = if ($tenantNotProvisioned) { "TENANT_NOT_INTUNE_PROVISIONED" } else { "DUPLICATE_CHECK_FAILED" }
        errorDetails = @{ operation = "duplicate_check"; error = $errorMessage }
        retryable = -not $tenantNotProvisioned
        runId = "$env:GITHUB_RUN_ID"
        runUrl = "$env:GITHUB_SERVER_URL/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
    } -CallbackUrl $env:CALLBACK_URL -CallbackSecret $env:CALLBACK_SECRET -MaxRetries 5 | Out-Null
    $env:ERROR_SENT = "true"
    echo "ERROR_SENT=true" >> $env:GITHUB_ENV
    throw
}
