[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AfterEffectsRoot,
    [switch]$AllVersions
)

$ErrorActionPreference = "Stop"
# Part of the release synchronisation list in CLAUDE.md; tests/validate-script.js
# checks this against package.json.
$IslandChatterVersion = "1.0.7"
# After Effects releases this plug-in is built and verified against.
$MinimumSupportedYear = 2025
$payloadRoot = Split-Path -Parent $PSScriptRoot
$requiredFiles = @(
    "IslandChatterNative.aex",
    "island_chatter_bake.exe",
    "IslandChatterNativePanel.jsx",
    "IslandChatterMandarinReadings.jsxinc"
)

foreach ($requiredFile in $requiredFiles) {
    $requiredPath = Join-Path $payloadRoot $requiredFile
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Missing release payload: $requiredPath"
    }
}

if (Get-Process -Name AfterFX -ErrorAction SilentlyContinue) {
    throw "Close After Effects before installing Island Chatter, then run this installer again."
}

function Get-AfterEffectsRoots {
    if ($AfterEffectsRoot) {
        return ,(Get-Item -LiteralPath $AfterEffectsRoot).FullName
    }

    $adobeRoot = Join-Path $env:ProgramFiles "Adobe"
    if (-not (Test-Path -LiteralPath $adobeRoot -PathType Container)) {
        return @()
    }

    # Sort by the parsed release year, not by the folder name. A plain string
    # sort ranks "Adobe After Effects CC 2019" above "Adobe After Effects 2026"
    # because "C" sorts after "2", which picked an unsupported host.
    $roots = Get-ChildItem -LiteralPath $adobeRoot -Directory |
        Where-Object { $_.Name -like "Adobe After Effects *" } |
        ForEach-Object {
            $year = 0
            if ($_.Name -match '(\d{4})') { $year = [int]$Matches[1] }
            [PSCustomObject]@{
                Year = $year
                Path = (Join-Path $_.FullName "Support Files")
            }
        } |
        Where-Object { Test-Path -LiteralPath $_.Path -PathType Container } |
        Sort-Object -Property Year -Descending

    $supported = @($roots | Where-Object { $_.Year -ge $MinimumSupportedYear })
    if ($supported.Count -eq 0 -and $roots.Count -gt 0) {
        $names = ($roots | ForEach-Object { "$($_.Year)" }) -join ", "
        throw ("Island Chatter is built for After Effects $MinimumSupportedYear and newer. " +
            "Found only: $names. Pass -AfterEffectsRoot to install anyway.")
    }

    if ($AllVersions) { return @($supported | ForEach-Object { $_.Path }) }
    if ($supported.Count -gt 0) { return ,$supported[0].Path }
    return @()
}

$targets = @(Get-AfterEffectsRoots)
if ($targets.Count -eq 0) {
    throw "No After Effects Support Files directory was found. Pass -AfterEffectsRoot explicitly."
}

foreach ($target in $targets) {
    $pluginDirectory = Join-Path $target "Plug-ins\Island Chatter"
    $panelDirectory = Join-Path $target "Scripts\ScriptUI Panels"

    if ($PSCmdlet.ShouldProcess($target, "Install Island Chatter $IslandChatterVersion")) {
        try {
            New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
            New-Item -ItemType Directory -Path $panelDirectory -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterNative.aex") `
                -Destination (Join-Path $pluginDirectory "IslandChatterNative.aex") -Force
            Copy-Item -LiteralPath (Join-Path $payloadRoot "island_chatter_bake.exe") `
                -Destination (Join-Path $pluginDirectory "island_chatter_bake.exe") -Force
            Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterNativePanel.jsx") `
                -Destination (Join-Path $panelDirectory "IslandChatterNativePanel.jsx") -Force
            Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterMandarinReadings.jsxinc") `
                -Destination (Join-Path $panelDirectory "IslandChatterMandarinReadings.jsxinc") -Force
        } catch [System.UnauthorizedAccessException] {
            throw ("Cannot write to '$target'. Run this installer from a PowerShell window " +
                "opened with 'Run as administrator'.`n" +
                "無法寫入 '$target'，請以系統管理員身分開啟 PowerShell 後再執行安裝。")
        }
        Write-Host "Installed Island Chatter $IslandChatterVersion to: $target"
    }
}

Write-Host "Start After Effects, then open Window > IslandChatterNativePanel.jsx."
