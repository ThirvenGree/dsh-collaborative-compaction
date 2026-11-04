param([string]$Destination = (Join-Path $PSScriptRoot '.engine'))
$ErrorActionPreference = 'Stop'
$baseCommit = '39a0ada58f396ec6e5ee29fdbaa01c01b74f14d9'
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists; choose an empty path. No existing checkout is overwritten.' }
function CheckExit { if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
git clone --no-checkout https://github.com/ranxianglei/billion-context.git $Destination
CheckExit
Push-Location $Destination
try {
    git checkout --detach $baseCommit
    CheckExit
    git apply --check (Join-Path $PSScriptRoot 'patches/billion-context-v0.1.209.patch')
    CheckExit
    git apply (Join-Path $PSScriptRoot 'patches/billion-context-v0.1.209.patch')
    CheckExit
    npm.cmd ci --ignore-scripts
    CheckExit
    node (Join-Path $PSScriptRoot 'scripts/check-dependencies.mjs') . --sqlite
    CheckExit
    npm.cmd run build
    CheckExit
    node --import tsx --test tests/collaborative-transaction.test.ts tests/external-summary-runtime.test.ts tests/search-original-evidence.test.ts tests/search-context-cross-session.test.ts tests/ccr-plugin.test.ts
    CheckExit
} finally { Pop-Location }
Write-Output "Patched engine ready: $Destination"
