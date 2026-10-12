[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$guardianRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $guardianRoot
$logRoot = Join-Path $guardianRoot 'logs'
if (-not (Test-Path -LiteralPath $logRoot)) {
    New-Item -ItemType Directory -Path $logRoot | Out-Null
}
$codexJs = Join-Path $env:APPDATA 'npm\node_modules\@openai\codex\bin\codex.js'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $codexJs) -or -not (Test-Path -LiteralPath $node)) {
    throw 'The authenticated Codex CLI or Node.js is unavailable.'
}
& $node (Join-Path $guardianRoot 'repair-process.mjs') $guardianRoot $workspaceRoot $codexJs $PID
exit $LASTEXITCODE
