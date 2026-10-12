<#
.SYNOPSIS
    Extracts icons from installers for a batch of apps.

.DESCRIPTION
    Reads apps-to-process.json (winget_id plus optional cached_installer_url /
    cached_installer_sha256), resolves an installer for each app, verifies it
    against a trusted SHA256, and calls extract-icon.ps1 to produce the PNG
    sizes under public/icons/<winget_id>/.

    Results are written to icon-results.json. Any entries already present in
    that file (family-inherited successes written by the caller) are preserved.

    Environment contract:
      MISSING_SIZES_ONLY  'true' to leave existing icon sizes untouched
      BUDGET_MINUTES      wall-clock ceiling for the loop; 0 disables it
      GITHUB_WORKSPACE    repository root (used to locate extract-icon.ps1)
      GITHUB_OUTPUT       optional; receives extracted= and failed= counts

    Shared by the weekly extract-icons.yml pipeline and the sharded
    heal-icons.yml campaign so both run byte-identical extraction logic.
#>

$ErrorActionPreference = 'Continue'

$skipExisting = $env:MISSING_SIZES_ONLY -eq 'true'
if ($skipExisting) {
  Write-Host "Top-up mode: existing icon sizes will be preserved" -ForegroundColor Cyan
}

$apps = Get-Content "apps-to-process.json" | ConvertFrom-Json

# Parse a winget installer manifest, pairing each InstallerUrl with
# the InstallerSha256 that belongs to it. Prefers a hashed x64
# exe/msi/msix entry so the downloaded binary is verifiable against
# the same community-reviewed manifest the URL came from.
function Get-InstallerFromManifest {
  param([string]$YamlContent)
  $records = @()
  $current = $null
  foreach ($line in ($YamlContent -split "`n")) {
    if ($line -match '^\s*InstallerUrl:\s*(.+?)\s*$') {
      if ($current) { $records += $current }
      $current = @{ url = $matches[1].Trim(); sha256 = $null }
    } elseif ($line -match '^\s*InstallerSha256:\s*([A-Fa-f0-9]{64})\s*$') {
      if ($current -and -not $current.sha256) { $current.sha256 = $matches[1] }
    }
  }
  if ($current) { $records += $current }
  $hashed = @($records | Where-Object { $_.sha256 })
  $preferred = @($hashed | Where-Object { $_.url -match '\.(exe|msi|msix|msixbundle|appx)(\?|$)' } |
    Sort-Object { if ($_.url -match 'x64|win64|64-bit|amd64') { 0 } else { 1 } } |
    Select-Object -First 1)
  if ($preferred.Count -gt 0) { return $preferred[0] }
  if ($hashed.Count -gt 0) { return $hashed[0] }
  return $null
}

function Resolve-InstallerFromWinget {
  # Tiers 2 and 3: resolve the current installer URL and its community-reviewed
  # SHA256 straight from the winget manifest. Called when version_history has
  # no cached URL, and again when a cached URL turns out to be stale.
  param(
    [Parameter(Mandatory=$true)][string]$WingetId,
    [string]$LatestVersion
  )

  $parts = $WingetId.Split('.')
  $publisher = $parts[0]
  $firstLetter = $publisher.Substring(0,1).ToLower()
  $namePath = $parts[1..($parts.Length-1)] -join '/'
  $rawBaseUrl = "https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests/$firstLetter/$publisher/$namePath"

  $encodedParts = $parts[1..($parts.Length-1)] | ForEach-Object { [uri]::EscapeDataString($_) }
  $encodedNamePath = $encodedParts -join '/'
  $encodedPublisher = [uri]::EscapeDataString($publisher)
  $apiBaseUrl = "https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests/$firstLetter/$encodedPublisher/$encodedNamePath"

  if ($LatestVersion) {
    try {
      Write-Host "Tier 2: Using latest_version '$LatestVersion' with raw URL"
      $installerYamlUrl = "$rawBaseUrl/$LatestVersion/$WingetId.installer.yaml"
      $yamlContent = Invoke-WebRequest -Uri $installerYamlUrl -UseBasicParsing -ErrorAction Stop -TimeoutSec 30
      $info = Get-InstallerFromManifest -YamlContent $yamlContent.Content
      if ($info) { return $info }
    } catch {
      Write-Host "Tier 2 failed for $WingetId : $($_.Exception.Message)"
    }
  }

  try {
    Write-Host "Tier 3: Listing versions via GitHub API"
    $versions = Invoke-RestMethod -Uri $apiBaseUrl -Headers @{ 'User-Agent' = 'IntuneGet' } -ErrorAction Stop -TimeoutSec 30
    $versionDirs = $versions | Where-Object { $_.type -eq 'dir' -and $_.name -match '^\d' }
    $resolved = ($versionDirs | Sort-Object { [version]($_.name -replace '[^\d.]', '.') } -Descending -ErrorAction SilentlyContinue | Select-Object -First 1).name
    if (-not $resolved) {
      $resolved = ($versionDirs | Sort-Object name -Descending | Select-Object -First 1).name
    }

    if ($resolved) {
      $installerYamlUrl = "$rawBaseUrl/$resolved/$WingetId.installer.yaml"
      $yamlContent = Invoke-WebRequest -Uri $installerYamlUrl -UseBasicParsing -ErrorAction Stop -TimeoutSec 30
      $info = Get-InstallerFromManifest -YamlContent $yamlContent.Content
      if ($info) { return $info }
    }
  } catch {
    Write-Warning "Tier 3 failed for $WingetId : $_"
  }

  return $null
}

function Get-InstallerExtension {
  param([Parameter(Mandatory=$true)][string]$Url)
  if ($Url -match '\.msi(\?|$)') { return '.msi' }
  if ($Url -match '\.msixbundle(\?|$)') { return '.msixbundle' }
  if ($Url -match '\.msix(\?|$)') { return '.msix' }
  if ($Url -match '\.appx(\?|$)') { return '.appx' }
  return '.exe'
}

# Preserve family-inherited successes written by the get-apps step;
# this file is rewritten below so they must be carried through.
$priorResults = @()
if (Test-Path "icon-results.json") {
  try { $priorResults = @(Get-Content "icon-results.json" -Raw | ConvertFrom-Json) } catch {}
}

$extracted = 0
$failed = 0
$deferred = 0
$results = @()

# Wall-clock ceiling. Installer downloads make per-app cost wildly
# uneven, so a fixed app count cannot bound the run. Apps we never
# reach are left completely untouched -- no attempt counter, no
# failure reason -- so the next run re-selects them and resumes
# exactly where this one stopped.
$budgetMinutes = 0
[int]::TryParse($env:BUDGET_MINUTES, [ref]$budgetMinutes) | Out-Null
$deadline = if ($budgetMinutes -gt 0) {
  (Get-Date).AddMinutes($budgetMinutes)
} else {
  [datetime]::MaxValue
}

foreach ($app in $apps) {
  if ((Get-Date) -gt $deadline) {
    $deferred++
    continue
  }
  $wingetId = $app.winget_id
  Write-Host "`n=== Processing $wingetId ===" -ForegroundColor Cyan

  $failureReason = $null

  try {
    $iconDir = "public/icons/$wingetId"
    New-Item -ItemType Directory -Path $iconDir -Force | Out-Null

    $installerUrl = $null
    $installerPath = $null
    $manifestSha256 = $null
    $usedCachedUrl = $false

    if ($app.cached_installer_url) {
      Write-Host "Tier 1: Using cached installer URL from version_history"
      $installerUrl = $app.cached_installer_url
      $usedCachedUrl = $true
    }

    if (-not $installerUrl) {
      $info = Resolve-InstallerFromWinget -WingetId $wingetId -LatestVersion $app.latest_version
      if ($info) {
        $installerUrl = $info.url
        $manifestSha256 = $info.sha256
      }
    }

    if (-not $installerUrl) {
      Write-Warning "No installer URL found for $wingetId"
      $failureReason = 'no_installer_url'
      $failed++
      $results += @{
        winget_id = $wingetId
        status = 'failed'
        error = 'no_installer_url'
        failure_reason = $failureReason
      }
      continue
    }

    if (-not $app.cached_installer_sha256 -or $app.cached_installer_sha256 -notmatch '^[A-Fa-f0-9]{64}$') {
      # version_history had no trusted hash for this app. The winget
      # manifest we resolved the InstallerUrl from carries the same
      # community-reviewed InstallerSha256 -- that is an equally
      # trusted source and unblocks extraction for apps that never
      # went through version detection.
      if ($manifestSha256 -match '^[A-Fa-f0-9]{64}$') {
        Write-Host "No version_history hash - using InstallerSha256 from winget manifest"
        $app.cached_installer_sha256 = $manifestSha256
      } else {
        Write-Warning "No trusted SHA256 is available for $wingetId"
        $failureReason = 'missing_trusted_installer_hash'
        $failed++
        $results += @{
          winget_id = $wingetId
          status = 'failed'
          error = 'A trusted installer hash is required before binary parsing'
          failure_reason = $failureReason
        }
        continue
      }
    }

    $extension = Get-InstallerExtension -Url $installerUrl
    $installerPath = "$env:TEMP\installer_$([System.IO.Path]::GetRandomFileName())$extension"

    Write-Host "Downloading installer from $installerUrl"
    try {
      & "$env:GITHUB_WORKSPACE\.github\scripts\save-safe-download.ps1" `
        -Uri $installerUrl -Destination $installerPath -MaxBytes 524288000 -MaxRedirects 5 -TimeoutSeconds 90
    } catch {
      Write-Warning "Download failed or timed out for ${wingetId}: $_"
      $failureReason = 'download_timeout'
      $failed++
      $results += @{
        winget_id = $wingetId
        status = 'failed'
        error = "Download timeout or error"
        failure_reason = $failureReason
      }
      continue
    }

    if (-not (Test-Path $installerPath)) {
      Write-Warning "Failed to download installer for $wingetId"
      $failureReason = 'download_failed'
      $failed++
      $results += @{
        winget_id = $wingetId
        status = 'failed'
        error = 'download_failed'
        failure_reason = $failureReason
      }
      continue
    }

    $fileSize = (Get-Item $installerPath).Length
    $fileSizeMB = [math]::Round($fileSize / 1MB, 1)
    Write-Host "Downloaded $fileSizeMB MB"
    if ($fileSize -gt 500MB) {
      Write-Warning "Installer too large ($fileSizeMB MB) for $wingetId, skipping"
      Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
      $failureReason = 'installer_too_large'
      $failed++
      $results += @{
        winget_id = $wingetId
        status = 'failed'
        error = "Installer too large: ${fileSizeMB}MB"
        failure_reason = $failureReason
      }
      continue
    }

    $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    if ($actualHash -ine $app.cached_installer_sha256) {
      # version_history pairs an installer URL with the hash that URL served
      # when the version was recorded. Publishers who publish to a stable
      # "latest" link replace the file underneath it, so the pair goes stale
      # and the download stops matching. That is an outdated row, not a
      # tampered installer, and refusing outright loses apps we can still
      # verify. Re-resolve the current winget manifest and check against the
      # hash it publishes instead. A mismatch against a freshly resolved
      # manifest is still fatal.
      $recovered = $false

      if ($usedCachedUrl) {
        Write-Host "Cached hash is stale for $wingetId - re-resolving the winget manifest"
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
        $fresh = Resolve-InstallerFromWinget -WingetId $wingetId -LatestVersion $app.latest_version

        if ($fresh -and $fresh.sha256 -match '^[A-Fa-f0-9]{64}$') {
          $extension = Get-InstallerExtension -Url $fresh.url
          $installerPath = "$env:TEMP\installer_$([System.IO.Path]::GetRandomFileName())$extension"
          try {
            & "$env:GITHUB_WORKSPACE\.github\scripts\save-safe-download.ps1" `
              -Uri $fresh.url -Destination $installerPath -MaxBytes 524288000 -MaxRedirects 5 -TimeoutSeconds 90

            if (Test-Path $installerPath) {
              $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
              if ($actualHash -ieq $fresh.sha256) {
                Write-Host "Manifest hash matches after re-resolve for $wingetId"
                $installerUrl = $fresh.url
                $app.cached_installer_sha256 = $fresh.sha256
                $recovered = $true
              } else {
                Write-Warning "Freshly resolved manifest hash still does not match for $wingetId"
              }
            }
          } catch {
            Write-Warning "Re-resolve download failed for ${wingetId}: $_"
          }
        }
      }

      if (-not $recovered) {
        Write-Warning "SHA256 mismatch for $wingetId"
        Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
        $failureReason = 'installer_hash_mismatch'
        $failed++
        $results += @{
          winget_id = $wingetId
          status = 'failed'
          error = "Installer SHA256 did not match the trusted manifest"
          failure_reason = $failureReason
        }
        continue
      }
    }

    $iconSourceType = switch ($extension) {
      '.msi' { 'binary_msi' }
      '.msix' { 'binary_msix' }
      '.msixbundle' { 'binary_msix' }
      '.appx' { 'binary_msix' }
      default { 'binary_exe' }
    }

    $extractResult = & "$env:GITHUB_WORKSPACE\.github\scripts\extract-icon.ps1" `
      -InstallerPath $installerPath `
      -OutputDir $iconDir `
      -AppId $wingetId `
      -SkipExisting:$skipExisting 2>&1
    $extractExitCode = $LASTEXITCODE

    if ($extractExitCode -ne 0) {
      Write-Host "Icon extraction script returned exit code: $extractExitCode"
      Write-Host $extractResult
    }

    if (Test-Path "$iconDir/icon-64.png") {
      Write-Host "Successfully extracted icon for $wingetId" -ForegroundColor Green
      $extracted++
      $results += @{
        winget_id = $wingetId
        status = 'success'
        icon_path = "/icons/$wingetId/"
        icon_source = $iconSourceType
      }
    } else {
      Write-Warning "No icon extracted for $wingetId"
      $failureReason = 'no_icon_in_binary'
      $failed++
      $results += @{
        winget_id = $wingetId
        status = 'failed'
        error = 'No icon extracted'
        failure_reason = $failureReason
      }
    }
  } catch {
    Write-Warning "Error processing $wingetId : $_"
    $failureReason = 'extraction_error'
    $failed++
    $results += @{
      winget_id = $wingetId
      status = 'failed'
      error = $_.ToString()
      failure_reason = $failureReason
    }
  } finally {
    if ($installerPath -and (Test-Path $installerPath)) {
      Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    }
  }

  Start-Sleep -Seconds 1
}

Write-Host "`n=== Binary Icon Extraction Summary ===" -ForegroundColor Cyan
Write-Host "Extracted: $extracted"
Write-Host "Failed: $failed"
if ($deferred -gt 0) {
  Write-Host "Deferred to next run ($budgetMinutes-minute budget reached): $deferred"
}

ConvertTo-Json -InputObject @($priorResults + $results) -Depth 10 | Out-File "icon-results.json" -Encoding utf8NoBOM

echo "extracted=$extracted" >> $env:GITHUB_OUTPUT
echo "failed=$failed" >> $env:GITHUB_OUTPUT

exit 0
