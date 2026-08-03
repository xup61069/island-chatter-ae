[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AfterEffectsRoot,
    [switch]$AllVersions
)

$ErrorActionPreference = "Stop"
$payloadRoot = Split-Path -Parent $PSScriptRoot
$requiredFiles = @(
    "IslandChatterNative.aex",
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

    $roots = Get-ChildItem -LiteralPath $adobeRoot -Directory |
        Where-Object { $_.Name -like "Adobe After Effects *" } |
        ForEach-Object { Join-Path $_.FullName "Support Files" } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Container } |
        Sort-Object -Descending

    if ($AllVersions) { return @($roots) }
    if ($roots.Count -gt 0) { return ,$roots[0] }
    return @()
}

$targets = @(Get-AfterEffectsRoots)
if ($targets.Count -eq 0) {
    throw "No After Effects Support Files directory was found. Pass -AfterEffectsRoot explicitly."
}

foreach ($target in $targets) {
    $pluginDirectory = Join-Path $target "Plug-ins\Island Chatter"
    $panelDirectory = Join-Path $target "Scripts\ScriptUI Panels"

    if ($PSCmdlet.ShouldProcess($target, "Install Island Chatter 1.0.1")) {
        New-Item -ItemType Directory -Path $pluginDirectory -Force | Out-Null
        New-Item -ItemType Directory -Path $panelDirectory -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterNative.aex") `
            -Destination (Join-Path $pluginDirectory "IslandChatterNative.aex") -Force
        Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterNativePanel.jsx") `
            -Destination (Join-Path $panelDirectory "IslandChatterNativePanel.jsx") -Force
        Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterMandarinReadings.jsxinc") `
            -Destination (Join-Path $panelDirectory "IslandChatterMandarinReadings.jsxinc") -Force
        Write-Host "Installed Island Chatter 1.0.1 to: $target"
    }
}

Write-Host "Start After Effects, then open Window > IslandChatterNativePanel.jsx."
