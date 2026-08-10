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

- Current public release: `v1.9.1` (Windows x64).
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
  -> ScriptUI panel writes up to 128 UTF-16 code units into hidden effect parameters
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
| `native/panel/IslandChatterNativePanel.jsx` | ExtendScript/ScriptUI UI, Source Text transfer, Tone/native-effect setup, markers, rig sliders, the shared character rig and mouth switch, Type-On |
| `native/plugin/IslandChatterNative.cpp` | Thin Adobe SDK adapter and `PF_Cmd_AUDIO_RENDER` implementation |
| `native/plugin/params.hpp` | Persistent After Effects parameter ABI |
| `native/src/dsp.cpp` | UTF-8 planning, Mandarin readings, sandhi, kana, phoneme/event planning, synthesis, singing, random-access copying |
| `native/src/midi.cpp` | Standard MIDI file parsing and the monophonic top line; reads untrusted binary, so every read is bounds checked |
| `native/src/song.cpp` | Hands each lyric line as many notes as it wants, and encodes them as transport slots |
| `native/src/synthesis_cache.cpp` | Bounded thread-safe single-flight cache for AE block rendering |
| `native/generated/mandarin_readings.hpp` | Generated Unihan lookup table; do not hand-edit |
| `native/tools/bake_cli.cpp` | `island_chatter_bake`: renders a WAV, and reports the timing plan with `--plan` |
| `native/tests/dsp_tests.cpp` | DSP, Mandarin, random-access, bounds, singing, segment seams, and cache concurrency tests |
| `native/tests/midi_tests.cpp` | MIDI parsing, chord reduction, and every malformed file that must come back as a message rather than a crash |
| `native/tests/song_tests.cpp` | Lyric-to-note assignment, slot encoding, and the rounding that must not accumulate |
| `native/tests/ae-smoke-test.jsx` | Destructive temporary-project host smoke test; writes a report, closes the project, and quits AE |
| `native/tests/ae-panel-reapply-setup.jsx` | Manual host setup for applying the actual panel twice to a selected Chinese text layer |
| `tests/validate-script.js` | ExtendScript syntax and cross-file release/invariant validation |
| `IslandChatter.jsx` | Legacy file-based prototype; retained and tested, but not the primary native release path |
| `installer/` and `tools/package-release.ps1` | Windows installation and release packaging |
| `installer/README.txt` | The only instruction a buyer gets; UTF-8 with a BOM, CRLF |

## Compatibility invariants

1. **Parameter order is a saved-project ABI.** `params.hpp`, the native plug-in, the panel constants,
   PiPL version, and tests must remain synchronized. There are 279 slots including input: input
   `0`, visible voice controls `1-5`, text length `6`, text units 0-63 at `7-70`, creative
   controls `71-75`, tempo lock `76`, timbre `77-80`, text units 64-127 at `81-144`, melody
   length `145`, melody tempo/transpose/tone-blend/portamento/vibrato-delay `146-150`,
   melody slots 0-63 at `151-214`, and melody detail slots 0-63 at `215-278`.
   Append new parameters; never reorder or reuse a
   published index. Every appended parameter needs a default that reproduces the previous
   behaviour, or older projects change how they sound when they are opened.
2. **ExtendScript is ES3-era.** Avoid modern JavaScript syntax and APIs in `.jsx`/`.jsxinc` files.
   ES3's future-reserved words are far wider than modern JavaScript's, and Node parses
   `var byte = ...` without complaint, so the syntax check cannot see them. After Effects
   refuses the *whole panel* with "Illegal use of reserved word" and a line number.
   `tests/validate-script.js` catches them, but only because `stripLiterals()` blanks comments,
   strings and regex literals in **one left-to-right scan**. The four chained `.replace()`
   calls it used to do were wrong from 1.4.0 onward: the panel writes a generated expression
   containing the literal `"// Island Chatter mouth switch"`, stripping line comments first ate
   that string's closing quote, every quote after it paired one out of step, and most of the
   panel was blanked before the search ran. The guard reported success while checking nothing,
   and `var byte` reached a host in 1.7.0 development. A scan cannot get out of step, because
   it only ever leaves a construct through the delimiter it entered on. Do not simplify it back
   into chained replaces, and note that the regex-literal branch is needed because
   `bakeFileName()` matches a quote inside one.
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
7. **The text transport is two blocks of 64 UTF-16 units.** Units 0-63 at index 7, units 64-127
   at index 81, because the indices in between were published before the second block existed
   and cannot move. Both sides go through one helper — `textUnitProperty()` in the panel,
   `unit_at()` in the adapter — because `kParamTextFirst + index` walks off the end of the
   first block and into the creative controls. Surrogate pairs consume two units and must
   decode correctly; one left stranded by the limit is dropped rather than emitted as CESU-8.
   The limit exists because this is a parameter transport, not a text field: 128 units is a
   long line of Chinese and about twenty words of English.
8. **Synthesis is deterministic.** Text, all voice settings, seed, and sample rate belong in the
   cache key. The runtime remains dependency-free and ships no audio samples.
8b. **The panel asks the engine for the plan; it must never compute one.** Markers, the
   rig, Type-On and Fit Duration all need to know where each syllable falls.
   `planFromEngine()` runs `island_chatter_bake --plan` and parses the result, reading the
   arguments off the effect so the plan describes what will actually render.

   Until 1.0.10 the panel reimplemented `build_speech_units()`, the readings table, the
   phrase table, tone sandhi and the punctuation rests in ExtendScript. The two copies
   could not agree even in principle, because the engine varies each syllable's length by
   a seeded random amount: ordinary Chinese drifted by up to 10 ms, and the copy knew
   nothing about inline overrides, Zhuyin, tone-number pinyin or the 64-unit truncation.
   `[重|chong2]新開始` planned twelve syllables against the four that are spoken and sized
   the layer 1.28 s too long. Adding a language would have meant writing that planner
   twice. `npm test` fails if any of those symbols reappear in the panel.

   The exception is tempo mode: `speedForTempo()` converts BPM to a Speed *before*
   anything is written to the effect, so there is nothing to ask about yet. It needs
   `styleSpeedMultiplier()` and `SYLLABLE_STRIDE`, both cross-checked against `dsp.cpp`.

   The plan is line-oriented ASCII with characters as decimal codepoints, because
   `system.callSystem()` returns stdout through the console code page and would turn
   Chinese into `?`. `END <count>` is checked on the way in: `callSystem()` reports no
   exit status, so a tool that died halfway would otherwise read as a short utterance.
8c. **Animated voice parameters cost a fresh plan.** After Effects hands an audio effect one
   parameter snapshot per audio block, and the effect reads only the block-start half of
   `params[]`. Every distinct Pitch/Speed/Consonant value is a new cache key; animating Speed
   also moves every syllable, so block boundaries can step audibly. Values are quantised to
   slider precision to limit the damage. Do not present these as smoothly animatable without
   first reading the second parameter set and proving the result in an AE host test.
   **Volume is exempt** and must stay that way: the utterance is rendered at `kReferenceVolume`
   and Volume is applied as a gain in `Utterance::copy_region`, so it is absent from the cache
   key. `kReferenceVolume` equals the parameter default, which is what keeps a project left at
   78% rendering bit-identically to 1.0.2.
8d. **Rendering is lazy and must stay bit-identical to `synthesize()`.** `Utterance` plans the
   syllables up front (about 0.6 ms) and renders only those overlapping each requested block.
   That is safe because every `Event` carries its own seed and filter state, so a syllable
   renders the same whether or not its neighbours did. Any change that makes one syllable
   depend on another breaks this, and `dsp_tests.cpp` compares the two paths across awkward
   block sizes and every Volume setting.
8e. **The panel's Bake calls `island_chatter_bake`, not the render queue.** The tool ships
   beside the `.aex` and is built from the same sources; `tools/package-release.ps1` refuses to
   package without it. Paths and text cross the boundary as hex UTF-8: `system.callSystem()`
   converts the command line to the console code page, which turns any character outside it
   into `?`. `tests/bake-cli.test.js` covers exactly that case.
8f. **The release package root holds only decisions.** `Install.bat`, `Uninstall.bat`,
   `README.txt` and `LICENSE`; everything else lives in `resources\`. Nine items with three
   plausible-looking `.aex`/`.jsx` files in the middle left first-time buyers guessing.
   `Install-IslandChatter.ps1` searches `$PSScriptRoot`, its parent, and the parent's
   `resources\` for the payload rather than assuming a shape, so packages built before 1.0.10
   still install. `tests/validate-script.js` asserts the staging of every payload file, both
   that it goes into `resources\` and that it does not also appear at the top.
8g. **An imported WAV is only released by a purge.** Verified against After Effects 26:
   after `importFile()`, the file cannot be deleted or rewritten. Removing the layer does
   not help, and neither does removing the `FootageItem`. `app.purge()` does, for every
   target except `SNAPSHOT_CACHES`. `UNDO_CACHES` is what Bake uses, being the cheapest
   that works — the undo history goes but the RAM preview survives. Bake renders before
   it touches the project and only releases the previous bake if the write failed, so a
   first bake never purges. `native/tests/ae-rebake-probe.jsx` is the diagnostic.
8h. **Kana is spoken, kanji is not guessed.** A syllabary needs no dictionary, so Japanese
   costs nothing to install and nothing to keep synchronised. Kanji is another matter: the
   reading depends on the word, so unmarked kanji keeps its Mandarin reading and the panel
   warns. The same applies to は and へ, which are particles only sometimes — こんにちは is
   wa, おはよう is ha, and no local rule separates them. `kKanaPhrases` holds only the fixed
   greetings where there is no ambiguity; keep it tiny, like `kPhrasePronunciations`.
   Do not add a heuristic here without a Japanese corpus to measure it against.
8i. **The panel's interface language is not a render setting.** It never reaches the effect:
   kana is read as Japanese and Han characters as Mandarin whatever the panel is showing.
   Labels stay written as `"English / 中文"` throughout and `localiseTree()` translates them
   in one pass after the panel is built, so `IC_JAPANESE_UI` is keyed by those literals and
   `npm test` fails when a renamed label strands its translation.
8j. **English is syllabified, not spelled out.** `english_syllables()` works a word at a time,
   because English spelling only means anything at that scale — though, through and tough
   share four letters and no sounds. It is deliberately a small rule set rather than the
   published NRL letter-to-sound rules: there are over three hundred of those and reproducing
   them from memory would introduce errors nothing here could detect. It is not a
   pronunciation dictionary. What it has to get right is the syllable count, the vowel colour
   and the stress, and `dsp_tests.cpp` pins those against a word list. Unstressed syllables
   reduce to a schwa and shorten to roughly half; that alternation is most of what makes it
   sound like English. Tempo lock flattens it, because a beat grid and a stress pattern
   cannot both be satisfied.
8k. **"Native effect is not installed" usually is not.** `addNativeEffect()` wraps whatever
   `addProperty()` threw, so a registration bug in the plug-in surfaces as a message about
   installation. The real error is worth reading before theorising: the one that has already
   happened once is *"parameter count mismatch in plug-in effect"*, which After Effects raises
   when `out_data->num_params` disagrees with the number of `PF_ADD_*` calls. The effect still
   appears in `app.effects`, because that comes from the PiPL, so "it is registered" proves
   nothing. Apply the effect in a scratch project and print the raw exception; each
   build-install-launch cycle costs about three minutes, so guessing is expensive.
8l. **A rig is merged in one place, and the merge is not in After Effects.**
    `mergeRigTimeline()` decides every number a rig carries, for one line and for twenty,
    and returns keys for a caller that only knows how to write a hold key. That is why
    `tests/validate-script.js` can pin the whole mechanism without a host, and why the
    per-layer rig and the shared rig cannot drift apart: one line through the same function
    reproduces what 1.3.0 wrote, key for key, which is what stops a re-Apply moving an
    existing project's animation.

    Two decisions live only there. The syllable counter runs across the whole timeline
    rather than restarting each line, because a per-line count throws the head the same way
    at every line's first syllable and blinks on every line's fifth. And when two lines of
    one character overlap, the later one wins from the moment it starts and the earlier one
    is cut there, rather than being left to close the mouth in the middle of the later one.

    A line points at its rig with an `ADBE Layer Control` named `IC Rig Target`, not by
    name: names are the user's to change and layers are theirs to reorder. The same control
    is what the generated mouth expression reaches through, so renaming a character cannot
    break six expressions at once. A pointer at nothing, at a deleted layer, or at a layer
    that is not a rig all read as unbound — `rigTargetLayer()` is the only place that
    decides this.

    The rig holds keyframes, not expressions. Nothing evaluates at render time, the project
    animates without the plug-in installed, and a rig that has lost a line goes stale rather
    than erroring. The cost is that it does not follow a line moved in time, which Rebuild
    exists to fix; do not replace this with an expression that scans members without first
    measuring the per-frame cost across twenty lines.

    The character's voice is stored in the rig layer's `comment`, which is the only writable
    string After Effects gives a layer. That is deliberate: saved characters in
    `app.settings` do not survive the project moving to another machine.

    `native/tests/ae-host-regression.jsx` section 11 covers what no unit test can see,
    including evaluating the generated mouth expression through `valueAtTime()` — a
    generated expression that is merely well-formed proves nothing.
8m. **An imported line is split; a typed line is truncated.** Apply on a layer the user
    wrote reports the truncation and speaks the first `MAX_TEXT_UNITS` units, because
    silently rewriting what someone typed is worse than telling them. `importScript()` has
    no typist to tell, so `splitForTransport()` turns a long line into as many layers as it
    needs. The cut goes to the last punctuation before the limit and never through a
    pronunciation override or a surrogate pair — half of `[重|chong2]` is broken on both
    sides of the break, and half a surrogate pair is not a character. The pathological input
    is one override longer than the whole transport: it cannot be kept whole, and the only
    requirement is that the loop terminates.

    Sequencing forces Fit Duration on regardless of the checkbox, because laying lines end
    to end means knowing where each one ends and only the plan knows. The composition is
    grown **before** each layer is placed, not after: Fit Duration clamps to the end of the
    composition, so a line placed past it is squashed to nothing rather than reported. It is
    trimmed back afterwards to whatever the script actually needs, never below what it was.
8n. **The panel's own state is a preference, and preferences must not interrupt.**
    `remember()` writes one flat `name=number` string on every control change; `restoreState()`
    reads it a field at a time, so a state written by an older version simply has fewer names
    in it. It runs last in `buildUI()`, after `localiseTree()`, or the defaults every control
    was built with would overwrite it. The Speed write goes behind `writingSpeed`, because an
    unguarded one reads as the user dragging the slider and switches tempo mode off. Saving is
    chained onto existing handlers with `alsoRemember()`, never assigned over them — several
    of those controls already carry `refreshTempo`.
8o. **Apply writes the panel's voice; Re-sync writes nobody's.** `resyncLayer()` reads the
    voice back off the effect with `settingsFromEffect()` and puts it straight back, so
    editing text cannot repaint a layer. It must never reach for a panel setting: a selection
    spanning two characters is the case this exists to make safe. What it rebuilds is decided
    by what the layer already carries — `hadMarkers`, `hadOwnRig`, `hadTypeOn` — never by the
    panel's checkboxes, or re-syncing would add markers to a line that deliberately has none.

    The operations that lay out time grow the composition; Apply does not. Import, Re-flow and
    Re-sync all refit a line against the plan, and After Effects clamps an out point at the end
    of the composition, so a line that no longer fits is squashed to whatever room was left
    rather than reported. Putting a voice on a layer is not a request to change how long the
    film is, which is why Apply keeps the clamp.
8p. **The gap between lines is a minimum note value, not a distance.** `nextLineStart()` adds
    the gap and then snaps forward. Converting beats to seconds and adding them would put
    nothing on the grid: a line is only a whole number of beats long under Tempo Lock, which is
    exactly the case where the two agree — so a test that only exercises tempo-locked lengths
    cannot tell them apart.

    `gridStep()` is what makes the number a note value: the grid is as fine as the gap asks
    for, so 0.5 reaches a quaver grid and 0.25 a semiquaver one. Snapping to a whole beat
    regardless — which is what 1.6.0 shipped — makes a fraction indistinguishable from a whole
    beat, because both round up to the same beat most of the time. The user's report was
    "decimals are not supported". A gap of one beat or more still uses the plain beat grid,
    since "leave two beats" means any beat two beats away rather than only every second one,
    and a gap of zero asks for no grid at all.

    `snapForward()` carries a tolerance because Re-flow snaps its first line on every run, and
    without it floating-point dust walks the whole scene one step later each press; at 137 BPM
    this is reproducible within a few lines.
8s. **A menu item is not a bilingual label.** `T()` keeps one side of anything containing
    `" / "`, which is right for `"Pitch / 音高"` and wrong for a value that merely has a slash
    in it. The tempo subdivision menu shipped as `"1 / beat"` through `"4 / beat"` and showed
    four entries reading `beat` in Chinese and four bare numbers in English, from 1.2.0 to
    1.6.0 — the control kept working, so nothing noticed. `npm test` now localises every
    dropdown in the panel into all three languages and fails if two items in one menu collapse
    to the same label. Write menu items as real `"English / 中文"` pairs.

    Re-flow shifts `startTime`, never `inPoint`, so a line the user has trimmed keeps its trim.
    Keyframes do not follow a moved layer, so every rig the moved lines belong to is merged
    again afterwards, and baked audio is moved by the same delta.
8q. **A speaker prefix is only read when the user says the script has them.** Nothing separates
    `咪咪：早安` from `注意：這裡很危險`, so `splitSpeaker()` is gated behind a checkbox rather
    than a heuristic; the portable tests assert that it *is* ambiguous, to stop anyone
    "fixing" it into a guess. Do not add one without a corpus to measure it against.
8r. **A stale bake is muted, not re-baked.** Baking disables the live effect, so after an edit
    the layer plays what it used to say. `markBakeStale()` mutes the recording, re-enables the
    effect and Tone, and marks the layer; Apply must never call the bake path, because
    releasing an imported WAV needs `app.purge()` and that discards the undo history on an
    action the user presses constantly. The recording is found through the `IC Bake` Layer
    Control first and only then by name, because Import names every layer after its own text
    and an edit therefore renames it.
8t. **A melody is two sliders per note, and length zero is what keeps 1.6.x safe.**
    A note does not fit in sixteen bits beside its pitch, so it is split across two appended
    blocks:

        melody slot : pitch * 512 + coarse       pitch 0-127, 0 meaning a rest
        detail slot : velocity * 512 + extra     velocity 0 meaning "not given"
        ticks       = coarse * 4 + extra         a tick is a ninety-sixth of a beat

    That split is not decoration: it is what let 1.8.0 make the grid four times finer without
    reinterpreting a published index. A 1.7.0 project has no detail block, so its slots read
    as zero, `ticks = coarse * 4`, and because the unit shrank by the same factor of four the
    duration is bit-for-bit the one it always meant. Velocity zero means the file said nothing
    about dynamics, not that the note is silent — and `velocity_level()` reaches exactly 1.0 at
    127, so a melody at full velocity sounds like one carrying no velocity at all.

    A ninety-sixth of a beat divides sixty-fourth notes (6 ticks) and thirty-second triplets
    (8). Sixty-four slots per block, each registered in one loop, appended after the block
    before it for the same reason that one was appended where it was.

    The engine never infers singing from the notes alone: `melody_mode` is a separate flag,
    because the importer has to ask how many notes a lyric line wants *before* it has any,
    and the answer differs — a hyphen is a held syllable when singing and a rest when
    speaking. With `melody_mode` false every path is the one 1.6.1 took, and
    `dsp_tests.cpp` pins that an empty melody renders bit-identically.

    The melody is not a panel setting. `setEffectParameters()` leaves the layer's melody
    alone when the settings object carries none, so pressing Apply on a line that is singing
    does not turn it back into speech; only Import, which passes one explicitly, writes it.
    An empty array is not the same as nothing and does clear it.
8u. **A held note is rendered in segments, and everything continuous is a function of
    note-global time.** The lazy renderer's unit of work is one event. A four-second note
    left whole would be rendered in full the moment any block touched any part of it, which
    is the 60-135 ms audio-thread stall `Utterance` exists to remove — so anything longer
    than `kSegmentSeconds` becomes several chained events.

    That only works because the phase, the vibrato and the fixed oscillators are written
    against `time_offset + local` rather than `local`. `sung_phase()` is a real integral of
    the instantaneous frequency for exactly this reason: the speaking engine's
    frequency-times-elapsed-time shorthand makes the vibrato swing grow with how long the
    note is held, and it cannot be evaluated at an arbitrary offset. Both terms — an
    exponential glide and a ramped sinusoid — are elementary on purpose.

    `describe()` folds the segments, and any melisma, back into one syllable. Without that a
    two-second note arrives at the panel as eight markers, eight mouth shapes and eight
    Type-On steps. `dsp_tests.cpp` measures the step at each seam against the largest step
    anywhere else in the note — not against every step, which would include the seams and
    could never fail.
8x. **The mouth shuts on a gap, not on a percentage.** Speaking, every syllable closes at 82%
    of its length and the closed span runs to the next syllable — in dialogue that includes the
    gap and any punctuation rest, so it lasts long enough to read as a mouth closing, and it is
    the chatter look the product is named for. Sung notes butt straight together, so the same
    rule leaves only the 18% bite: measured on a real song line, 36 closes in 5.4 seconds with
    24 of them shorter than one frame at 30 fps. Hold keys are sampled per frame, so which ones
    landed was arbitrary and the mouth twitched rather than closed. The same rule failed the
    other way on a held note, shutting the mouth for 360 ms in the middle of a two-second "ah".

    A sung line therefore closes only when the silence after a note is at least
    `MOUTH_CLOSE_FRAMES` frames long, and always at the end of the line. **Frames, not seconds**
    — the failure is a frame-sampling artefact, so a threshold in seconds would simply reappear
    at another frame rate. `mergeRigTimeline()` takes `comp.frameDuration` for this and stays
    pure. The head bounce is capped at `SUNG_BOUNCE_SECONDS` on the same path, or a four-beat
    note leans slowly to one side for three quarters of a second.

    The new rule is bound to the line carrying a melody, not applied globally, so speech is
    untouched: `validate-script.js` pins every spoken key against what 1.3.0 wrote (invariant
    8l) and that pin still passes unchanged.
8w. **Nothing sung is ever truncated to make it fit; it is split on a bar line.** A layer
    carries 64 melody slots and 128 text units, and a line over either becomes as many layers
    as it needs. `song::assign()` decides the note count in a dry pass *before* encoding
    anything, precisely so that running out of room can back the cut up to the last downbeat —
    a cut mid-bar reads as a mistake, one on the bar line reads as a line. The downbeat is
    recorded *before* the budget check, not after, or the note that does not fit is never
    considered and the cut backs up a whole bar further than it needed to.

    Bars come from the file: `midi::File::bar_line_at()` reads FF 58 and restarts the grid at
    every meter change, which is what notation programs do. A file with no time signature is
    4/4, as the format says.

    The text is cut by asking the engine — `prefix_for_syllables()` binary-searches on
    `syllable_count()` — never by counting characters, and `safe_cut()` keeps the break out of
    the middle of a `[重|chong2]` override and off a UTF-8 continuation byte.
8v. **A sung note is at its written pitch, and `voice.pitch` is not applied.** The presets
    run from 0.66 to 1.42, so letting a character's register into the melody would transpose
    it by up to a fifth and put two characters singing the same tune in different keys. What
    makes a character sound like itself is the vocal tract and the timbre, which is also how
    it works in people; Transpose exists for moving a whole line deliberately. The Mandarin
    tone contour becomes the *approach* to each note rather than a shape across it, because
    a held syllable cannot both keep its tone and stay on pitch.
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
their own composition, save nothing, and do not quit After Effects.

Drive them with **`AfterFX.exe -ro <script>`**, not `-r`. With `-r`, After Effects refuses to
start a second script whenever one is already running — an open ScriptUI panel counts — and
says so in a modal dialog. Automation sees no error, no report, and an idle process that looks
like a hang. `-ro` overrides that. Wait for the report file rather than for the process to
exit, since the launcher returns immediately:

| Script | Covers |
| --- | --- |
| `native/tests/ae-host-regression.jsx` | Effect-stack order, the 76-slot ABI round trip, Fit Duration against the plan, markers, rig, repeat Apply and handle invalidation, keyframed rig sliders, a Tone the user owns, cameras/lights/solids in the comp, batch apply, truncation reporting, the shared rig and the mouth switch |
| `native/tests/ae-typeon-verify.jsx` | Type-On first/repeat apply, no duplicate animators, reveal actually animates, apply after the user keyframes Opacity and End |
| `native/tests/ae-audio-render.jsx` | Renders the effect to audio through the render queue |
| `native/tests/ae-text-animator-probe.jsx` | Diagnostic for the text-animator placeholder behaviour in invariant 3b |
| `native/tests/ae-rebake-probe.jsx` | Diagnostic for what releases an imported WAV, behind invariant 8f |

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

