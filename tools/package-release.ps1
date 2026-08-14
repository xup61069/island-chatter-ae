[CmdletBinding()]
param(
    [string]$Version = "3.5.0",
    # Empty means "find the newest build". Pass a path to pin one explicitly.
    [string]$AexPath = "",
    # Package the trial instead of the product. The payload is identical — the
    # difference is inside the binaries, which sign the audio they render — so
    # this switch does not choose what to copy. What it does is decide which
    # token the staged binaries must carry, and refuse the other one.
    [switch]$Trial
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
# ships as its own file and is copied fresh below.
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
$buildRelease = Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $resolvedAex))) "Release"
$resolvedBake = Join-Path $buildRelease "island_chatter_bake.exe"
if (-not (Test-Path -LiteralPath $resolvedBake -PathType Leaf)) {
    throw "Build island_chatter_bake first. Missing: $resolvedBake"
}
# The cloud voice is the same story: the panel's button finds nothing and says
# so, but it says so at the moment somebody presses it, which is the worst place
# to discover that a release was packaged incompletely.
$resolvedVoice = Join-Path $buildRelease "island_chatter_voice.exe"
if (-not (Test-Path -LiteralPath $resolvedVoice -PathType Leaf)) {
    throw "Build island_chatter_voice first. Missing: $resolvedVoice"
}
# The offline voice, and the one DLL it needs.
#
# It only builds when ISLAND_CHATTER_ONNXRUNTIME_ROOT is set, so refusing here
# is also what stops a release being cut from a tree that was never configured
# for it — the same reason the bake and voice tools are required rather than
# copied if present.
#
# sherpa-onnx is deliberately absent, and this is the note that stops somebody
# adding it back: the DLL it publishes statically links espeak-ng (GPL v3 or
# later) with no switch to exclude it, and the GPL attaches to the file that is
# distributed rather than to the code paths that run. That is what held 3.0.0
# back. ONNX Runtime is MIT and runs the same model.
$resolvedLocal = Join-Path $buildRelease "island_chatter_local.exe"
if (-not (Test-Path -LiteralPath $resolvedLocal -PathType Leaf)) {
    throw ("Build island_chatter_local first. Missing: $resolvedLocal`n" +
        "  Configure with -DISLAND_CHATTER_ONNXRUNTIME_ROOT=<unpacked onnxruntime-win-x64>")
}
$resolvedRuntime = Join-Path $buildRelease "onnxruntime.dll"
if (-not (Test-Path -LiteralPath $resolvedRuntime -PathType Leaf)) {
    throw "Build island_chatter_local first; onnxruntime.dll is copied beside it. Missing: $resolvedRuntime"
}
$strandedSherpa = Join-Path $buildRelease "sherpa-onnx-c-api.dll"
if (Test-Path -LiteralPath $strandedSherpa -PathType Leaf) {
    throw ("$strandedSherpa is in the build directory. It statically links espeak-ng " +
        "(GPL v3+) and must not reach a package; delete it and rebuild.")
}
Write-Host "Packaging plug-in: $resolvedAex ($aexTime)"
Write-Host "Packaging bake tool: $resolvedBake"
Write-Host "Packaging voice tool: $resolvedVoice"
Write-Host "Packaging offline voice: $resolvedLocal"

$distRoot = Join-Path $repoRoot "dist"
$flavour = if ($Trial) { "-Trial" } else { "" }
$stageRoot = Join-Path $distRoot "Island-Chatter-AE-$Version$flavour-Windows-x64"
$zipPath = "$stageRoot.zip"

if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
$resources = Join-Path $stageRoot "resources"
New-Item -ItemType Directory -Path $resources -Force | Out-Null

# Only four things at the top of the extracted folder, one of which is the thing
# to double-click. Nine items with three plausible-looking .jsx/.aex files in the
# middle left first-time buyers guessing, so everything that is not a decision
# goes into resources\ and the installer looks for it there.
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/Install.bat") `
    -Destination (Join-Path $stageRoot "Install.bat")
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/Uninstall.bat") `
    -Destination (Join-Path $stageRoot "Uninstall.bat")
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/README.txt") `
    -Destination (Join-Path $stageRoot "README.txt")
Copy-Item -LiteralPath (Join-Path $repoRoot "LICENSE") -Destination (Join-Path $stageRoot "LICENSE")

Copy-Item -LiteralPath $resolvedAex -Destination (Join-Path $resources "IslandChatterNative.aex")
Copy-Item -LiteralPath $resolvedBake -Destination (Join-Path $resources "island_chatter_bake.exe")
Copy-Item -LiteralPath $resolvedVoice -Destination (Join-Path $resources "island_chatter_voice.exe")
Copy-Item -LiteralPath $resolvedLocal -Destination (Join-Path $resources "island_chatter_local.exe")
Copy-Item -LiteralPath $resolvedRuntime -Destination (Join-Path $resources "onnxruntime.dll")
Copy-Item -LiteralPath (Join-Path $repoRoot "native/panel/IslandChatterNativePanel.jsx") `
    -Destination (Join-Path $resources "IslandChatterNativePanel.jsx")
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/Install-IslandChatter.ps1") `
    -Destination (Join-Path $resources "Install-IslandChatter.ps1")
Copy-Item -LiteralPath (Join-Path $repoRoot "installer/Uninstall-IslandChatter.ps1") `
    -Destination (Join-Path $resources "Uninstall-IslandChatter.ps1")
Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") `
    -Destination (Join-Path $resources "THIRD_PARTY_NOTICES.md")

# The check 3.0.0 did not do.
#
# That release was held back because a dependency turned out to statically link
# espeak-ng (GPL v3+), and the reason it got as far as a built package is that
# the licence was checked by *reading about* the library instead of by looking
# inside the file. So this looks inside the file: every binary about to be
# zipped is searched for the marker, and a hit stops the release.
#
# It is a byte search over an ASCII view of the whole file, which is what finds
# a statically linked library that no header mentions. `strings` would do, but
# it is not on every Windows machine and a guard that silently does not run is
# the shape of failure this project keeps a section of CLAUDE.md about.
$signed = 0
$unsigned = 0
foreach ($binary in (Get-ChildItem -LiteralPath $resources -File |
        Where-Object { $_.Extension -in ".exe", ".dll", ".aex" })) {
    $text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($binary.FullName))
    foreach ($marker in @("espeak", "eSpeak")) {
        if ($text.Contains($marker)) {
            throw ("$($binary.Name) contains '$marker'. eSpeak NG is GPL v3 or later and the " +
                "GPL attaches to the file that is distributed, not to the code paths that " +
                "run. This is what held 3.0.0 back. See THIRD_PARTY_NOTICES.md.")
        }
    }
    # Which build these binaries actually are, read out of the files rather
    # than assumed from the switch. Shipping the trial as the product gives it
    # away; shipping the product as the trial marks audio somebody paid for.
    # Only the ones that link the engine carry a token at all.
    if ($text.Contains("ISLAND-CHATTER-TRIAL")) { $signed += 1 }
    elseif ($text.Contains("ISLAND-CHATTER-RELEASE")) { $unsigned += 1 }
}
if ($Trial) {
    if ($signed -eq 0) {
        throw ("None of the staged binaries carry the trial token. Configure a separate " +
            "build directory with -DISLAND_CHATTER_TRIAL=ON and package from that.")
    }
    if ($unsigned -gt 0) {
        throw ("$unsigned of the staged binaries are release builds and $signed are trial " +
            "builds. A package with both signs its previews and not its exports; build " +
            "them all in the one trial directory.")
    }
} else {
    if ($signed -gt 0) {
        throw ("$signed of the staged binaries carry the trial token, which would sign the " +
            "audio of a product somebody paid for. Package the release from a build " +
            "directory configured without -DISLAND_CHATTER_TRIAL.")
    }
    if ($unsigned -eq 0) {
        throw ("No staged binary carries a build token at all. Something that does not link " +
            "the engine is being packaged in place of something that does.")
    }
}
# And the plug-in by name, because it is the file that renders the audio inside
# After Effects. The counts above are satisfied by any one binary carrying the
# right token, and the first run of this check found the .aex carrying *neither*
# — nothing in it called build_kind(), so the linker had dropped the string and
# a trial .aex could have shipped as the product unnoticed.
$aexText = [Text.Encoding]::ASCII.GetString(
    [IO.File]::ReadAllBytes((Join-Path $resources "IslandChatterNative.aex")))
$wantedToken = if ($Trial) { "ISLAND-CHATTER-TRIAL" } else { "ISLAND-CHATTER-RELEASE" }
if (-not $aexText.Contains($wantedToken)) {
    throw ("IslandChatterNative.aex does not carry $wantedToken. It is the file that renders " +
        "the audio; if it cannot say which build it is, nothing downstream can either.")
}
Write-Host ("Build token: {0} ({1} binaries)" -f
    ($(if ($Trial) { "TRIAL" } else { "RELEASE" }), $(if ($Trial) { $signed } else { $unsigned })))

Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
Set-Content -LiteralPath "$zipPath.sha256" -Value ("{0}  {1}" -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $zipPath)) -Encoding ascii
Write-Host $zipPath
