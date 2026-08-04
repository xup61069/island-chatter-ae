[CmdletBinding()]
param(
    [string]$Version = "1.0.7",
    # Empty means "find the newest build". Pass a path to pin one explicitly.
    [string]$AexPath = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if ($AexPath) {
    $resolvedAex = Join-Path $repoRoot $AexPath
    if (-not (Test-Path -LiteralPath $resolvedAex -PathType Leaf)) {
        throw "Build the native plug-in first. Missing: $resolvedAex"
    }
} else {
    # Several build directories can coexist (native/build-ae, build-ae-outer...).
    # Always take the newest, never merely the first one found, or a release can
    # silently ship a stale binary from an earlier configuration.
    $candidates = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot "native") -Directory `
            -Filter "build*" -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "plugin\Release\IslandChatterNative.aex" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Get-Item | Sort-Object -Property LastWriteTime -Descending)
    if ($candidates.Count -eq 0) {
        throw ("Build the native plug-in first. No IslandChatterNative.aex found under " +
            (Join-Path $repoRoot "native\build*\plugin\Release"))
    }
    $resolvedAex = $candidates[0].FullName
    if ($candidates.Count -gt 1) {
        Write-Host "Multiple builds found; using the newest:"
        $candidates | ForEach-Object { Write-Host ("  {0}  {1}" -f $_.LastWriteTime, $_.FullName) }
    }
}

# A plug-in older than the sources it is compiled from is the one mistake this
# script must never let through. Only what actually links into the .aex counts:
# native/tests and native/tools build separate executables, and the panel .jsx
# and readings .jsxinc ship as their own files and are copied fresh below.
$aexTime = (Get-Item -LiteralPath $resolvedAex).LastWriteTime
$compiledExtensions = @(".cpp", ".hpp", ".h", ".r", ".cmake", ".txt")
$compiledRoots = @("src", "include", "generated", "plugin", "cmake") |
    ForEach-Object { Join-Path (Join-Path $repoRoot "native") $_ }
$compiledRoots += (Join-Path $repoRoot "native\CMakeLists.txt")
$newestSource = $compiledRoots |
    Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object {
        if (Test-Path -LiteralPath $_ -PathType Leaf) { Get-Item -LiteralPath $_ }
        else { Get-ChildItem -LiteralPath $_ -Recurse -File -ErrorAction SilentlyContinue }
    } |
    Where-Object { $compiledExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object -Property LastWriteTime -Descending |
    Select-Object -First 1
if ($newestSource -and $newestSource.LastWriteTime -gt $aexTime) {
    throw ("The plug-in is older than its sources. Rebuild before packaging.`n" +
        "  plug-in: $resolvedAex ($aexTime)`n" +
        "  source:  $($newestSource.FullName) ($($newestSource.LastWriteTime))")
}
# The bake tool is built from the same sources and must come from the same
# build directory as the plug-in, never from a stale one elsewhere.
$resolvedBake = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $resolvedAex))) "Release\island_chatter_bake.exe"
if (-not (Test-Path -LiteralPath $resolvedBake -PathType Leaf)) {
    throw "Build island_chatter_bake first. Missing: $resolvedBake"
}
Write-Host "Packaging plug-in: $resolvedAex ($aexTime)"
Write-Host "Packaging bake tool: $resolvedBake"

$distRoot = Join-Path $repoRoot "dist"
$stageRoot = Join-Path $distRoot "Island-Chatter-AE-$Version-Windows-x64"
$zipPath = "$stageRoot.zip"

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path (Join-Path $stageRoot "installer") -Force | Out-Null

Copy-Item -LiteralPath $resolvedAex -Destination (Join-Path $stageRoot "IslandChatterNative.aex")
Copy-Item -LiteralPath $resolvedBake -Destination (Join-Path $stageRoot "island_chatter_bake.exe")
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
