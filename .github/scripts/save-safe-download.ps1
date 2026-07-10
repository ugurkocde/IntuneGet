[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [Uri]$Uri,

    [Parameter(Mandatory = $true)]
    [string]$Destination,

    [Parameter(Mandatory = $false)]
    [long]$MaxBytes = 524288000,

    [Parameter(Mandatory = $false)]
    [ValidateRange(0, 10)]
    [int]$MaxRedirects = 5,

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 900)]
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'

function Test-PublicAddress {
    param([Parameter(Mandatory = $true)][System.Net.IPAddress]$Address)

    if ($Address.IsIPv4MappedToIPv6) {
        $Address = $Address.MapToIPv4()
    }

    if ($Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
        $bytes = $Address.GetAddressBytes()
        return -not (
            $bytes[0] -eq 0 -or
            $bytes[0] -eq 10 -or
            $bytes[0] -eq 127 -or
            ($bytes[0] -eq 100 -and $bytes[1] -ge 64 -and $bytes[1] -le 127) -or
            ($bytes[0] -eq 169 -and $bytes[1] -eq 254) -or
            ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
            ($bytes[0] -eq 192 -and $bytes[1] -eq 168) -or
            ($bytes[0] -eq 198 -and ($bytes[1] -eq 18 -or $bytes[1] -eq 19)) -or
            $bytes[0] -ge 224
        )
    }

    if ($Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
        $bytes = $Address.GetAddressBytes()
        return -not (
            [System.Net.IPAddress]::IsLoopback($Address) -or
            $Address.Equals([System.Net.IPAddress]::IPv6Any) -or
            $Address.IsIPv6LinkLocal -or
            $Address.IsIPv6SiteLocal -or
            $Address.IsIPv6Multicast -or
            (($bytes[0] -band 0xFE) -eq 0xFC)
        )
    }

    return $false
}

function Assert-SafeUri {
    param([Parameter(Mandatory = $true)][Uri]$Candidate)

    if ($Candidate.Scheme -ne 'https') { throw 'Only HTTPS installer URLs are allowed' }
    if (-not [string]::IsNullOrEmpty($Candidate.UserInfo)) { throw 'Credential-bearing installer URLs are not allowed' }

    $addresses = [System.Net.Dns]::GetHostAddresses($Candidate.DnsSafeHost)
    if ($addresses.Count -eq 0 -or @($addresses | Where-Object { -not (Test-PublicAddress $_) }).Count -gt 0) {
        throw 'Private, local, multicast, or reserved installer targets are not allowed'
    }
}

$currentUri = $Uri
$destinationDirectory = Split-Path -Parent $Destination
if ($destinationDirectory) {
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
}

try {
    for ($redirect = 0; $redirect -le $MaxRedirects; $redirect++) {
        Assert-SafeUri $currentUri

        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.AllowAutoRedirect = $false
        $client = [System.Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
        $client.DefaultRequestHeaders.UserAgent.ParseAdd('IntuneGet-IconExtractor/1.0')
        try {
            $response = $client.GetAsync(
                $currentUri,
                [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
            ).GetAwaiter().GetResult()

            if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) {
                if (-not $response.Headers.Location) { throw 'Installer redirect did not include a Location header' }
                if ($redirect -eq $MaxRedirects) { throw "Installer exceeded the $MaxRedirects redirect limit" }
                $currentUri = if ($response.Headers.Location.IsAbsoluteUri) {
                    $response.Headers.Location
                } else {
                    [Uri]::new($currentUri, $response.Headers.Location)
                }
                continue
            }

            $response.EnsureSuccessStatusCode() | Out-Null
            $declaredLength = $response.Content.Headers.ContentLength
            if ($declaredLength -and $declaredLength -gt $MaxBytes) {
                throw "Installer exceeds the $MaxBytes byte limit"
            }

            $input = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $output = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
            try {
                $buffer = [byte[]]::new(1048576)
                [long]$total = 0
                while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $total += $read
                    if ($total -gt $MaxBytes) { throw "Installer exceeds the $MaxBytes byte limit" }
                    $output.Write($buffer, 0, $read)
                }
            } finally {
                $output.Dispose()
                $input.Dispose()
            }
            return
        } finally {
            if ($response) { $response.Dispose() }
            $client.Dispose()
            $handler.Dispose()
        }
    }
} catch {
    Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    throw
}

throw 'Installer download failed without a terminal response'
