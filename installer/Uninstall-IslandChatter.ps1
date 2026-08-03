[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    [string]$AfterEffectsRoot,
    [switch]$AllVersions
)

$ErrorActionPreference = "Stop"

if (Get-Process -Name AfterFX -ErrorAction SilentlyContinue) {
    throw "Close After Effects before uninstalling Island Chatter."
}

function Get-AfterEffectsRoots {
    if ($AfterEffectsRoot) {
        return ,(Get-Item -LiteralPath $AfterEffectsRoot).FullName
    }
    $adobeRoot = Join-Path $env:ProgramFiles "Adobe"
    if (-not (Test-Path -LiteralPath $adobeRoot -PathType Container)) { return @() }
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
    if ($PSCmdlet.ShouldProcess($target, "Uninstall Island Chatter")) {
        $paths = @(
            (Join-Path $target "Plug-ins\Island Chatter\IslandChatterNative.aex"),
            (Join-Path $target "Scripts\ScriptUI Panels\IslandChatterNativePanel.jsx"),
            (Join-Path $target "Scripts\ScriptUI Panels\IslandChatterMandarinReadings.jsxinc")
        )
        foreach ($path in $paths) {
            if (Test-Path -LiteralPath $path -PathType Leaf) {
                Remove-Item -LiteralPath $path -Force
            }
        }
        $pluginDirectory = Join-Path $target "Plug-ins\Island Chatter"
        if ((Test-Path -LiteralPath $pluginDirectory -PathType Container) -and
            -not (Get-ChildItem -LiteralPath $pluginDirectory -Force)) {
            Remove-Item -LiteralPath $pluginDirectory -Force
        }
        Write-Host "Removed Island Chatter from: $target"
    }
}
