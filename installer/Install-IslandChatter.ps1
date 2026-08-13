[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AfterEffectsRoot,
    [switch]$AllVersions
)

$ErrorActionPreference = "Stop"
# Part of the release synchronisation list in CLAUDE.md; tests/validate-script.js
# checks this against package.json.
$IslandChatterVersion = "2.5.0"
# After Effects releases this plug-in is built and verified against.
$MinimumSupportedYear = 2025
$requiredFiles = @(
    "IslandChatterNative.aex",
    "island_chatter_bake.exe",
    "island_chatter_voice.exe",
    "IslandChatterNativePanel.jsx"
)

# The release package hides everything except the two launchers, so this script
# now sits beside its payload in resources\. Older packages put it in
# installer\ with the payload one level up, and either arrangement may still be
# on someone's disk. Look for the files rather than assuming a fixed shape.
$payloadCandidates = @(
    $PSScriptRoot,
    (Split-Path -Parent $PSScriptRoot),
    (Join-Path (Split-Path -Parent $PSScriptRoot) "resources")
)
$payloadRoot = $payloadCandidates | Where-Object {
    $candidate = $_
    $candidate -and (Test-Path -LiteralPath $candidate -PathType Container) -and
        -not ($requiredFiles | Where-Object {
            -not (Test-Path -LiteralPath (Join-Path $candidate $_) -PathType Leaf)
        })
} | Select-Object -First 1

if (-not $payloadRoot) {
    throw ("Cannot find the plug-in files. Expected " + ($requiredFiles -join ", ") +
        " in one of:`n  " + ($payloadCandidates -join "`n  ") +
        "`nExtract the whole ZIP before running the installer.")
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
            Copy-Item -LiteralPath (Join-Path $payloadRoot "island_chatter_voice.exe") `
                -Destination (Join-Path $pluginDirectory "island_chatter_voice.exe") -Force
            Copy-Item -LiteralPath (Join-Path $payloadRoot "IslandChatterNativePanel.jsx") `
                -Destination (Join-Path $panelDirectory "IslandChatterNativePanel.jsx") -Force
            # Shipped up to 1.0.10, when the panel stopped carrying its own copy
            # of the readings table and started asking the engine instead. It is
            # inert but it is 484 KB, and an upgrade is the only chance to
            # notice it: nothing else ever looks in this folder again.
            $strandedReadings = Join-Path $panelDirectory "IslandChatterMandarinReadings.jsxinc"
            if (Test-Path -LiteralPath $strandedReadings -PathType Leaf) {
                Remove-Item -LiteralPath $strandedReadings -Force
            }
            # Same idea, and it matters more: an offline-voice build was made
            # and installed before it was held back, and sherpa-onnx-c-api.dll
            # links espeak-ng (GPL v3+). Upgrading has to take those away rather
            # than leave 21 MB of them sitting in Program Files, where the panel
            # would still find the tool and offer a voice this build does not
            # support. THIRD_PARTY_NOTICES.md explains why it is held back.
            foreach ($stranded in @("island_chatter_local.exe",
                    "sherpa-onnx-c-api.dll", "onnxruntime.dll")) {
                $strandedPath = Join-Path $pluginDirectory $stranded
                if (Test-Path -LiteralPath $strandedPath -PathType Leaf) {
                    Remove-Item -LiteralPath $strandedPath -Force
                }
            }
        } catch [System.UnauthorizedAccessException] {
            throw ("Cannot write to '$target'. Run this installer from a PowerShell window " +
                "opened with 'Run as administrator'.`n" +
                "無法寫入 '$target'，請以系統管理員身分開啟 PowerShell 後再執行安裝。")
        }
        Write-Host "Installed Island Chatter $IslandChatterVersion to: $target"
    }
}

Write-Host "Start After Effects, then open Window > IslandChatterNativePanel.jsx."
