param([string]$Destination = (Join-Path $PSScriptRoot '.engine'))
$ErrorActionPreference = 'Stop'
$baseCommit = 'daa082ead8a8ead60311e29ad4627bff0f569fc1'
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists; choose an empty path. No existing checkout is overwritten.' }
function CheckExit { if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" } }
git clone --no-checkout https://github.com/ranxianglei/billion-context.git $Destination
CheckExit
Push-Location $Destination
try {
    git checkout --detach $baseCommit
    CheckExit
    git apply --check (Join-Path $PSScriptRoot 'patches/billion-context-v0.1.212.patch')
    CheckExit
    git apply (Join-Path $PSScriptRoot 'patches/billion-context-v0.1.212.patch')
    CheckExit
    npm.cmd ci --ignore-scripts
    CheckExit
    node (Join-Path $PSScriptRoot 'scripts/check-dependencies.mjs') . --sqlite --engine-version=0.1.212
    CheckExit
    npm.cmd run typecheck
    CheckExit
    npm.cmd run build
    CheckExit
    node --import tsx --test tests/collaborative-transaction.test.ts tests/external-summary-runtime.test.ts tests/search-original-evidence.test.ts tests/search-evidence-cache.test.ts tests/search-context-cross-session.test.ts tests/search-plan-aware.test.ts tests/search-index.test.ts tests/search-index-integration.test.ts tests/search-index-dist.test.ts tests/search-index-resume.test.ts tests/search-index-progress.test.ts tests/check-dist-external.test.ts tests/search-fts-acceptance.test.ts tests/ccr-plugin.test.ts
    CheckExit
    node --import tsx --test tests/dsh-native.test.ts
    CheckExit
} finally { Pop-Location }
Write-Output "Patched engine ready: $Destination"
