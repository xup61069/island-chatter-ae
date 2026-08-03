[CmdletBinding()]
param(
    [string]$Version = "1.0.1",
    [string]$AexPath = "native/build-ae-outer/plugin/Release/IslandChatterNative.aex"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedAex = Join-Path $repoRoot $AexPath
if (-not (Test-Path -LiteralPath $resolvedAex -PathType Leaf)) {
    throw "Build the native plug-in first. Missing: $resolvedAex"
}

$distRoot = Join-Path $repoRoot "dist"
$stageRoot = Join-Path $distRoot "Island-Chatter-AE-$Version-Windows-x64"
$zipPath = "$stageRoot.zip"

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path (Join-Path $stageRoot "installer") -Force | Out-Null

Copy-Item -LiteralPath $resolvedAex -Destination (Join-Path $stageRoot "IslandChatterNative.aex")
Copy-Item -LiteralPath (Join-Path $repoRoot "native/panel/IslandChatterNativePanel.jsx") `
    -Destination (Join-Path $stageRoot "IslandChatterNativePanel.jsx")
Copy-Item -LiteralPath (Join-Path $repoRoot "native/panel/IslandChatterMandarinReadings.jsxinc") `
    -Destination (Join-Path $stageRoot "IslandChatterMandarinReadings.jsxinc")
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/Install-IslandChatter.ps1") `
    -Destination (Join-Path $stageRoot "installer/Install-IslandChatter.ps1")
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/Uninstall-IslandChatter.ps1") `
    -Destination (Join-Path $stageRoot "installer/Uninstall-IslandChatter.ps1")
Copy-Item -LiteralPath (Join-Path $repoRoot "README.md") -Destination (Join-Path $stageRoot "README.md")
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $stageRoot "LICENSE")
Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") `
    -Destination (Join-Path $stageRoot "THIRD_PARTY_NOTICES.md")

Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
Set-Content -LiteralPath "$zipPath.sha256" -Value ("{0}  {1}" -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $zipPath)) -Encoding ascii
Write-Host $zipPath
