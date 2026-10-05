# Read-only verification of the QA Hyper-V host after the 2026-10-05 storage exhaustion.
# Run elevated. Makes no changes: only Get-* and Test-VHD calls.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot ('hyperv-verification-{0}.json' -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmZ'))
$result = [ordered]@{
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    verifiedBy    = "$env:USERDOMAIN\$env:USERNAME (elevated, read-only)"
    vmms          = (Get-Service vmms).Status.ToString()
    volumes       = @()
    vms           = @()
    errors        = @()
}
foreach ($v in Get-Volume | Where-Object DriveLetter) {
    $result.volumes += [ordered]@{ drive = "$($v.DriveLetter):"; freeGB = [math]::Round($v.SizeRemaining / 1GB, 1); sizeGB = [math]::Round($v.Size / 1GB, 1); health = "$($v.HealthStatus)" }
}
try {
    foreach ($vm in Get-VM -ErrorAction Stop) {
        $snaps = @(Get-VMSnapshot -VM $vm -ErrorAction SilentlyContinue)
        $disks = @()
        foreach ($d in Get-VMHardDiskDrive -VM $vm) {
            $ok = $false; $err = $null
            try { $ok = Test-VHD -Path $d.Path -ErrorAction Stop } catch { $err = $_.Exception.Message }
            $disks += [ordered]@{ path = $d.Path; exists = (Test-Path -LiteralPath $d.Path); testVhd = $ok; error = $err }
        }
        $result.vms += [ordered]@{
            name = $vm.Name; state = "$($vm.State)"; status = "$($vm.Status)"
            heartbeat = "$($vm.Heartbeat)"; parentCheckpoint = $vm.ParentCheckpointName
            checkpoints = @($snaps | ForEach-Object { [ordered]@{ name = $_.Name; created = $_.CreationTime.ToUniversalTime().ToString('o'); type = "$($_.SnapshotType)" } })
            disks = $disks
        }
    }
} catch { $result.errors += $_.Exception.Message }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding UTF8
