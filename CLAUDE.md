# Claude Code project guide

This file is the maintainer and code-review entrypoint for Island Chatter AE.
Read `README.md`, `native/README.md`, and this file before changing code.

## Review mode

- Default to review-only work unless the user explicitly asks for an implementation.
- Report findings in Traditional Chinese, ordered by severity, with exact file and line references.
- Separate confirmed defects from risks that still require an After Effects host test.
- Run the relevant automated tests before reaching a conclusion.
- Do not delete compatibility workarounds merely because a cleaner Adobe SDK path appears possible.

## Product baseline

- Current public release: `v1.0.2` (Windows x64).
- Supported host versions: After Effects 2025 and 2026.
- Confirmed host: After Effects 2026 on Windows 11.
- The v1.0.1 panel was applied twice to the same keyed Chinese text layer without an error.
- A human verified that the first audio preview was continuous after a cold start.
- The released ZIP contains no generated audio assets and produces no external WAV files.

The project is an original procedural Mandarin character-voice synthesizer. It must not include
Nintendo, Animal Crossing, or other copyrighted game audio or extracted assets.

## Runtime architecture

```text
AE text layer Source Text
  -> ScriptUI panel writes up to 64 UTF-16 code units into hidden effect parameters
  -> zero-level built-in AE Tone creates the host sound object
  -> Island Chatter Native receives AE audio block requests
  -> SynthesisCache shares one full deterministic render across concurrent block misses
  -> copy_region returns only the requested mono/stereo floating-point samples
```

The built-in Tone is an intentional bootstrap. AE 26 can crash in `BEE_RenderItemSound` before a
third-party synthesized-audio callback receives a text layer. Do not replace this design with
`PF_OutFlag_I_SYNTHESIZE_AUDIO` or remove Tone without a repeatable AE 2025/2026 host test proving
the alternative safe. Tone level must remain zero and Tone must be immediately before the native
effect.

## Source map

| Path | Responsibility |
| --- | --- |
| `native/panel/IslandChatterNativePanel.jsx` | ExtendScript/ScriptUI UI, Source Text transfer, Tone/native-effect setup, markers, rig sliders, Type-On |
| `native/plugin/IslandChatterNative.cpp` | Thin Adobe SDK adapter and `PF_Cmd_AUDIO_RENDER` implementation |
| `native/plugin/params.hpp` | Persistent After Effects parameter ABI |
| `native/src/dsp.cpp` | UTF-8 planning, Mandarin readings, sandhi, phoneme/event planning, synthesis, random-access copying |
| `native/src/synthesis_cache.cpp` | Bounded thread-safe single-flight cache for AE block rendering |
| `native/generated/mandarin_readings.hpp` | Generated Unihan lookup table; do not hand-edit |
| `native/panel/IslandChatterMandarinReadings.jsxinc` | Generated AE-side reading table; do not hand-edit |
| `native/tests/dsp_tests.cpp` | DSP, Mandarin, random-access, bounds, and cache concurrency tests |
| `native/tests/ae-smoke-test.jsx` | Destructive temporary-project host smoke test; writes a report, closes the project, and quits AE |
| `native/tests/ae-panel-reapply-setup.jsx` | Manual host setup for applying the actual panel twice to a selected Chinese text layer |
| `tests/validate-script.js` | ExtendScript syntax and cross-file release/invariant validation |
| `IslandChatter.jsx` | Legacy file-based prototype; retained and tested, but not the primary native release path |
| `installer/` and `tools/package-release.ps1` | Windows installation and release packaging |

## Compatibility invariants

1. **Parameter order is a saved-project ABI.** `params.hpp`, the native plug-in, the panel constants,
   PiPL version, and tests must remain synchronized. There are 76 slots including input: input `0`,
   visible voice controls `1-5`, text length `6`, 64 UTF-16 units `7-70`, and creative controls
   `71-75`. Append new parameters; never reorder or reuse a published index.
2. **ExtendScript is ES3-era.** Avoid modern JavaScript syntax and APIs in `.jsx`/`.jsxinc` files.
3. **AE invalidates Property handles after effect-stack mutation.** Reacquire effect groups and
   properties after `addProperty()` or reordering effects.
3b. **A text animator's Properties group cannot be probed for membership.** Verified against
   After Effects 26.0: `ADBE Text Animator Properties` reports all 103 animator properties as
   children whether or not they have been added, `numProperties` stays 103 after an add, and
   `canAddProperty()` returns `true` both before and after. Writing to one that was never
   added fails with "the property or a parent property is hidden". Call `addProperty()`
   unconditionally; it is idempotent and creates no duplicate. The `ADBE Text Selectors`
   group does not behave this way and can be tested normally. `native/tests/` holds the
   diagnostic pattern used to establish this.
4. **Keyed properties reject plain `setValue()`.** Use `setValueAtTime()` when keys exist. Rig
   defaults may be written with `setValue()` only when `numKeys === 0`. Tone level keys are cleared
   before setting its required zero value.
5. **Do not enable AE threaded-render opt-in yet.** The shared synthesis cache is thread-safe, but
   host-level threaded audio stress coverage is not complete. `PF_OutFlag2_SUPPORTS_THREADED_RENDERING`
   must stay absent until that coverage exists.
6. **Bound every audio write by the host destination.** Use `dest_snd.num_samples`; never infer the
   output size from requested duration alone.
7. **The 64 UTF-16-unit text limit is intentional.** It is the current hidden-parameter transport
   contract. Surrogate pairs consume two units and must decode correctly in the native adapter.
8. **Synthesis is deterministic.** Text, all voice settings, seed, and sample rate belong in the
   cache key. The runtime remains dependency-free and ships no audio samples.
8b. **The panel mirrors the engine's text planning.** `estimateSpeech()` and its helpers in
   `IslandChatterNativePanel.jsx` reproduce `build_speech_units()`, `punctuation_pause()`,
   `apply_character_style()`'s Speed multipliers, and the phrase/particle tables from
   `dsp.cpp`. Markers, the rig, Type-On, and Fit Duration all read that plan, so any change
   to one side must land on the other. `npm test` compares the shared tables, the timing
   constants, and the planner's output against pinned values.
8c. **Animated voice parameters cost a full re-synthesis.** After Effects hands an audio
   effect one parameter snapshot per audio block, and the effect reads only the block-start
   half of `params[]`. Every distinct Pitch/Speed/Volume/Consonant value is therefore a new
   cache key and a fresh render of the whole utterance; animating Speed also moves every
   syllable, so block boundaries can step audibly. Values are quantised to slider precision
   to limit the damage. Do not present these as smoothly animatable without first reading the
   second parameter set and proving the result in an AE host test.
9. **Generated reading tables stay synchronized.** Regenerate them with the scripts in
   `native/tools/`; do not patch individual generated entries.
10. **Source Text remains authoritative.** The user explicitly presses Apply again after editing.
    Background `app.scheduleTask` polling is intentionally forbidden because AE refuses scheduled
    scripts around modal dialogs.

## Build and test

Portable checks do not require the Adobe SDK:

```powershell
npm test
cmake -S native -B native/build
cmake --build native/build --config Release
ctest --test-dir native/build -C Release --output-on-failure
```

The `.aex` build requires the official After Effects SDK and is documented in `native/README.md`.
Do not vendor Adobe headers or PiPL tools.

Host verification order:

1. Close or save any user project; the smoke test refuses to touch a non-empty project.
2. Run `native/tests/ae-smoke-test.jsx` in AE and inspect `ae-smoke-test-result.txt` at the repository root.
3. Start a clean project and run `native/tests/ae-panel-reapply-setup.jsx`.
4. Open `Window > IslandChatterNativePanel.jsx` and press Apply twice on the selected text layer.
5. Confirm there is no `setValue()` keyframe alert and preview the full sentence on the first run.
6. Confirm no external audio files were created.

### Scripted host suites

These run unattended and each writes a report to the repository root. They build and remove
their own composition, save nothing, and do not quit After Effects. Drive them with
`AfterFX.exe -r <script>` while AE is already open, then read the report:

| Script | Covers |
| --- | --- |
| `native/tests/ae-host-regression.jsx` | Effect-stack order, the 76-slot ABI round trip, Fit Duration against the plan, markers, rig, repeat Apply and handle invalidation, keyframed rig sliders, a Tone the user owns, cameras/lights/solids in the comp, batch apply, truncation reporting |
| `native/tests/ae-typeon-verify.jsx` | Type-On first/repeat apply, no duplicate animators, reveal actually animates, apply after the user keyframes Opacity and End |
| `native/tests/ae-audio-render.jsx` | Renders the effect to audio through the render queue |
| `native/tests/ae-text-animator-probe.jsx` | Diagnostic for the text-animator placeholder behaviour in invariant 3b |

`ae-host-regression.jsx` and `ae-typeon-verify.jsx` load the real panel body with `eval`, so
they exercise the shipped code rather than a copy. If the panel's outer function or its
trailing `buildUI(thisObj)` call is renamed, update the two markers they search for.

After `ae-audio-render.jsx`, compare its output against the engine:

```powershell
node tools/compare-ae-audio-render.js <dsp-render.raw>
```

A correct build correlates at 1.0000 with zero lag, which also proves `start_sampL`
handling, mono-to-stereo copying and the absence of block dropouts. A stock After Effects
install has no WAV output template; the script uses `AIFF 48kHz`.

Mandarin intelligibility and voice quality remain human-listening checks.

## Release synchronization

For a version bump, update and validate all of these together:

- `package.json` (the source of truth for every other file)
- `native/CMakeLists.txt`
- `native/plugin/IslandChatterVersion.h` (stage must stay `PF_Stage_RELEASE`)
- `EXPECTED_VERSION` in `native/tests/ae-smoke-test.jsx`
- `$Version` in `tools/package-release.ps1`
- `$IslandChatterVersion` in `installer/Install-IslandChatter.ps1`
- `CHANGELOG.md`

The About text in `native/plugin/IslandChatterNative.cpp` derives from
`ISLAND_CHATTER_VERSION_TEXT` and must not hardcode a version. `npm test` checks every
item in this list, including the `PF_VERSION` encoding, so a half-landed bump fails.

Run `npm test` after any version or parameter change. Build the release `.aex`, package with
`npm run package:windows`, record SHA-256, and perform the AE host checks before publishing.

## Review priorities

Focus first on issues that can corrupt memory, crash AE, invalidate saved projects, deadlock audio
callbacks, produce discontinuous first-pass audio, or misread Chinese text. In particular, inspect:

- destination buffer bounds, negative/large sample offsets, mono/stereo copying, and sample rates;
- cache wait/notify, exception propagation, eviction while entries render, and cache-key completeness;
- UTF-16 surrogate decoding, the 64-unit boundary, pinyin/Zhuyin/inline overrides, and tone sandhi;
- repeat-Apply behavior with existing keyframes and effect-stack handle invalidation;
- installer version discovery, quoting, permissions, and uninstall scope;
- license and trademark compliance for generated data and release contents.

Treat subjective voice quality separately from correctness. Recommend DSP changes only with a small
reproducible Chinese phrase set and before/after listening evidence.

