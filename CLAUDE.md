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

- Current public release: `v3.7.0` (Windows x64).
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
| `native/src/analysis.cpp` | Reads a WAV or AIFF the user chose and finds the syllables and vowels in it; untrusted binary, so every read is bounds checked |
| `native/src/cloud.cpp` | The provider table, the request templates, the cache key and what a failed reply means. No network: everything here is decided before a socket exists, which is what makes it testable |
| `native/src/midi.cpp` | Standard MIDI file parsing and the monophonic top line; reads untrusted binary, so every read is bounds checked |
| `native/src/song.cpp` | Hands each lyric line as many notes as it wants, and encodes them as transport slots |
| `native/src/synthesis_cache.cpp` | Bounded thread-safe single-flight cache for AE block rendering |
| `native/generated/mandarin_readings.hpp` | Generated Unihan lookup table; do not hand-edit |
| `native/tools/bake_cli.cpp` | `island_chatter_bake`: renders a WAV, and reports the timing plan with `--plan` |
| `native/tools/voice_cli.cpp` | `island_chatter_voice`: the WinHTTP transport and nothing else. Windows-only by necessity rather than by choice — this is the TLS stack ExtendScript does not have |
| `native/tools/local_cli.cpp` | `island_chatter_local`: speaks a line with a neural model on this machine, opening no socket, and prints the protocol the panel already parses. Links ONNX Runtime (MIT) and nothing else; built when `ISLAND_CHATTER_ONNXRUNTIME_ROOT` points at an unpacked `onnxruntime-win-x64` release — referenced by path, never vendored, exactly as the AE SDK is. **The licence chain is the reason this file is not Piper and no longer sherpa-onnx:** Piper went GPL-3.0 in October 2025 and its MIT-era releases still linked espeak-ng (GPL v3+); sherpa-onnx is Apache-2.0 but the `sherpa-onnx-c-api.dll` it publishes *statically links espeak-ng anyway* — `if(SHERPA_ONNX_ENABLE_TTS)` pulls it in unconditionally, with no option to exclude — and the GPL attaches to the file that is distributed, not to the code paths that run. That is what stopped 3.0.0 shipping. The check that missed it asked whether the *Chinese pipeline uses* espeak-ng (a consequence) instead of whether the *shipped binary contains* it (the mechanism), which is one `strings` away |
| `native/src/melo.cpp` | The offline voice's front end: text to the two integer sequences the model wants. Chinese is read by the *engine* (invariant 8ac), Japanese by the model's own lexicon (8ag), the lexicon also supplies English, and digits are spelled out here because dropping sherpa-onnx dropped its OpenFST normalisers. Pure, so `melo_tests.cpp` covers all of it without a 170 MB model |
| `native/generated/melo_phonemes.hpp` | Generated pinyin-to-phone table; do not hand-edit. `native/tools/generate-melo-phonemes.js` derives it by joining the model's own single-character lexicon entries against Unihan readings and letting 20,888 characters vote |
| `native/tests/melo_tests.cpp` | The generated table against the model's real token list, the number spelling, the bracket rule, punctuation folding, and that 銀行 still comes out `hang2` — which only the engine knows |
| `native/tests/ae-language-verify.jsx` | Host suite for the interface language: builds the panel and switches it through all three |
| `native/tests/dsp_tests.cpp` | DSP, Mandarin, random-access, bounds, singing, segment seams, and cache concurrency tests |
| `native/tests/analysis_tests.cpp` | The WAV/AIFF reader against every malformed file it must survive, formants against synthesised vowels, and the analyser scored against the engine's own plan |
| `native/tests/cloud_tests.cpp` | Every request each provider builds, the escaping, the refusal of a key with a line break in it, the completeness and separation of the cache key, SHA-256 against the FIPS vectors, and six real provider error bodies that must arrive intact |
| `native/tests/midi_tests.cpp` | MIDI parsing, chord reduction, and every malformed file that must come back as a message rather than a crash |
| `native/tests/song_tests.cpp` | Lyric-to-note assignment, slot encoding, and the rounding that must not accumulate |
| `native/tests/ae-lipsync-verify.jsx` | Host suite for audio lip-sync: bakes its own WAV, imports it, analyses it, and checks the rig, the trim, and both refusals |
| `native/tests/ae-local-verify.jsx` | Host suite for the offline voice: the merged source list, which tool serves each row, that a local source is asked for no key, a real render through ONNX Runtime when the model is installed, and the tuning — that it misses the cache, that speed 0.5 comes back *longer*, and that a speaker the model does not have is refused by number rather than imported as silence |
| `native/tests/ae-cloud-verify.jsx` | Host suite for the cloud voice, run entirely on a cache hit so it opens no socket and bills nobody: seeds the path `--cache-path` names with a bake, then checks the import, the muted effect, the plan coming out of the recording, the stale rule putting it back on the engine, and that Apply re-fetches nothing |
| `native/tests/ae-smoke-test.jsx` | Destructive temporary-project host smoke test; writes a report, closes the project, and quits AE |
| `native/tests/ae-panel-reapply-setup.jsx` | Manual host setup for applying the actual panel twice to a selected Chinese text layer |
| `AI-GUIDE.md` | The usage reference an assistant reads when someone hands it the repository URL. Its label and message tables are generated by `tools/build-ai-guide.js`; run `npm run build:ai-guide` after renaming anything the panel says, or `npm test` fails |
| `tests/validate-script.js` | ExtendScript syntax and cross-file release/invariant validation |
| `IslandChatter.jsx` | Legacy file-based prototype; retained and tested, but not the primary native release path |
| `installer/` and `tools/package-release.ps1` | Windows installation and release packaging |
| `installer/README.txt` | The only instruction a buyer gets; UTF-8 with a BOM, CRLF |

## Compatibility invariants

1. **Parameter order is a saved-project ABI.** `params.hpp`, the native plug-in, the panel constants,
   PiPL version, and tests must remain synchronized. There are 290 slots including input: input
   `0`, visible voice controls `1-5`, text length `6`, text units 0-63 at `7-70`, creative
   controls `71-75`, tempo lock `76`, timbre `77-80`, text units 64-127 at `81-144`, melody
   length `145`, melody tempo/transpose/tone-blend/portamento/vibrato-delay `146-150`,
   melody slots 0-63 at `151-214`, melody detail slots 0-63 at `215-278`, the custom-timbre
   flag `279` and ten measured vowel formants at `280-289`.
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
8ab. **A cloud voice is a bake with a different renderer, and it may never become
   anything else.**
   The engine renders a WAV and the panel imports it; a provider renders a WAV and the panel
   imports it. Everything between those two sentences — the folder beside the project, the
   `IC Bake` pointer, `releasePreviousBake()`, muting the live effect, going stale on an edit —
   is the same code, unchanged, and that is the design rather than a convenience.

   **It cannot be a live effect and the reason is not performance.** An audio callback that
   waits on a network is an After Effects that has stopped responding, for an interval nobody
   controls. Invariant 8 says synthesis is deterministic; that stays true only because nothing
   here is ever reachable from `PF_Cmd_AUDIO_RENDER`. `island_chatter_cloud` is deliberately a
   separate static library from `island_chatter_dsp` for exactly this reason — the .aex links
   the second and not the first, and `npm test` fails if `cloud.cpp` appears in the first.

   **What is new is only which plan a line follows.** A baked line can keep the engine's plan
   because the bake *is* the engine. A cloud voice cannot, so `planForLayer()` reads the plan
   out of the recording through 2.3.0's `--analyse` — and that is the entirety of the
   downstream change, because invariant 8aa made the two formats identical. The switch lives
   in one function and `rebuildSharedRig()` goes through it.

   **The stale rule is what keeps the mouth honest.** `markBakeStale()` mutes the recording and
   re-enables the live effect, so after a text edit what is *heard* is the engine again.
   `cloudVoiceLayer()` therefore returns nothing for a muted recording, and the plan goes back
   to the engine at the same instant the sound does. One `audioEnabled` check ties them; without
   it the mouth animates to timings that are no longer audible and nothing on screen says why.
   Apply and Re-sync must never re-fetch: that would put a purchase behind a keystroke.

   **The key is never an argument.** Task Manager will show any process's full command line to
   anyone who turns the column on. The panel writes the key to a temp file and passes the path;
   the tool reads it and deletes the file *before* opening the socket, and the panel deletes it
   again afterwards. `parse_arguments()` **refuses** `--key` rather than not implementing it,
   because an unimplemented flag is an ignored flag and a future edit would see nothing go
   wrong. Both ends are pinned — `cloud_tests.cpp` for the tool, `validate-script.js` for the
   panel.

   **The credential must not follow a redirect, and the reply is bounded.** WinHTTP follows
   3xx by default and re-sends the request headers on the redirected request, which here means
   handing the API key to whatever host the redirect names — a mistyped endpoint, a hijacked
   DNS answer, or simply a provider that changed. None of the three endpoints legitimately
   redirects, so `WINHTTP_DISABLE_REDIRECTS` is set and the call **fails** if that option does
   not apply, rather than proceeding with a protection that is not there. The read loop stops
   at `kMaxReplyBytes`: it has no other reason to stop, and an endpoint that streams without
   end would otherwise be read until the machine runs out of memory. TLS 1.2+ is requested
   explicitly, best-effort; `WINHTTP_FLAG_SECURE` is not optional.

   **A voice source is not necessarily remote, and the panel must ask rather than assume.**
   Every row in the table carries `on_this_machine`, false for all three today. The expensive
   part of 3.0.0's offline model is not the model: it is a panel that has assumed in four
   separate places that a source needs an API key, needs a region, needs the network and needs
   to warn that the text is leaving the computer. None of those is true of a local model, and a
   confirmation that says "the text leaves this computer" when it does not is worse than no
   confirmation — it teaches people to click through the one warning that matters. All four are
   pinned in `validate-script.js`, so adding the row in 3.0.0 stays a row.

   **The socket is deliberately untestable, and everything it feeds is not.** There is no
   `--endpoint` override and there must never be one: a flag that points the tool at an
   arbitrary host is a flag that hands that host the API key, which is the same hole disabling
   redirects exists to close. So a fake server is not the shape of this test. Instead every
   *decision* the transport makes is a pure function — `meaning_of_network_error()` for the
   four failures that never reach a status code, `message_from_error()` for the ones that do,
   `wav_from_reply()` for a body that is the right length and the wrong thing — and each is
   pinned. What remains unverified is the round trip itself, and it should be said out loud
   rather than implied by a green suite.

   **The provider table is data, and there is one copy.** Host, path, headers, body template and
   reply format are strings; the transport branches on none of them. The panel does not know a
   single URL — it runs `--providers`. A second table in the panel would drift the first time a
   vendor changed a default and would drift *silently*, the menu still working and still showing
   the right names, which is invariant 8b's lesson applied to something other than timing.
   Providers are chosen for returning uncompressed PCM or WAV, so no audio decoder ships: a
   decoder would be the largest piece of untrusted-input parsing in the product.

   **Errors are the provider's own words.** A refused key, a rate limit, an exhausted quota and
   an unreachable host need four different actions, and the provider already distinguishes them.
   Invariant 8k is the record of what folding them into one sentence costs. Six real bodies are
   pinned in `cloud_tests.cpp`; the message travels back as hex UTF-8 on **stdout**, because
   `callSystem()` returns stdout and the console code page would otherwise destroy exactly the
   sentence that matters.

   **The cache is the part that saves money, so it is complete or it is wrong.** File names are
   a SHA-256 of provider, model, voice, region, rate, format and text — every field that changes
   the sound, and not the key. A missing separator between two fields is not a lost cache entry:
   it is the wrong line's audio under this line's subtitle, silently. `cache_material()` is
   exposed and its fields are *counted*, because only some boundaries can be reached from
   `Params` and a test written from the outside covers two of them while reporting that it has
   covered the mechanism. The file is written to a `.part` and renamed, or a half-written entry
   poisons the cache permanently — it exists, so every later run hits it.

   **Spending is a press, and the press says what it costs.** The confirmation states how many
   lines, how many characters and which provider, and says the text leaves the machine.
   `npm test` fails if `confirm()` moves after the first request, and if `applyToTextLayer`,
   `resyncLayer`, `rebuildSharedRig`, `reflowLayers` or `importScript` can reach a provider at
   all. The storefront page is checked too: it may not still claim nothing is exported, it must
   tell readers in all three languages that their text leaves, and its version must match
   `package.json` — it had been stale since 2.1.0 because nothing was looking.

8ac. **The offline voice reads with the engine, and the model only sings the notes it is
   given.**
   A neural model needs two integer sequences: a phone per position and a tone per position.
   Producing them means deciding how the text is read, and this product already has something
   that decides that. `melo::plan()` therefore hands the Chinese to `dsp::Utterance` — the same
   reader the built-in voice uses — and translates the pinyin it gets back.

   **The model's own lexicon cannot do it, and the reason is not quality.** Its 195,828 keys are
   Simplified words, so `銀行` is not in it at all and Traditional text degrades to
   character-by-character lookup: `yin2 xing2`, silently. It knows nothing about `[重|chong2]`,
   Zhuyin, or tone-number pinyin either. Reading with the engine is what makes the same line
   come out the same way whichever voice speaks it, which is invariant 8b's argument applied to
   a second renderer rather than to a second planner. `melo_tests.cpp` pins `銀行` at `hang2`
   precisely because that is the assertion a lexicon-based reader cannot pass.

   **The pinyin-to-phone table is derived, not written.** MeloTTS spells finals its own way —
   `ye` is `y E`, `yan` is `y En`, `ya` is `y a`, `weng` is `w eng`, `i` is `ir` after zh/ch/sh/r
   and `i0` after z/c/s — and six of those would have been wrong from memory, which is what
   invariant 8j says about reproducing somebody else's tables. So
   `generate-melo-phonemes.js` joins the model's 20,888 single-character entries against Unihan
   and lets them vote: 378 syllables carry five or more characters, the remaining 36 are
   rebuilt from those, and the rebuilding rule reproduces all 378 exactly. Four syllables have
   no phones — the syllabic nasals — and the test pins that list so it cannot grow quietly.

   **Digits are spelled out here because the FSTs went with sherpa-onnx.** Four OpenFST rule
   files did number, date, phone and heteronym normalisation, and reading them needs OpenFST.
   Without a replacement `2026年` reaches the engine as `年`: the digits produce no syllable and
   vanish. `normalise_numbers()` is that replacement, and it must leave `[...]` alone —
   `[重|chong2]` normalised as a number becomes `[重|chong二]`, which is not a reading of
   anything.

   **What cannot be said is said out loud.** Kana, an emoji, a syllable with no phones: the tool
   prints `WARN` after its `OK` and the panel reports it once. The analyser reads the file, not
   the script, so this is the only place the difference can surface.

8ag. **Japanese is the one place the model's lexicon reads the text, and the reason is
   specific.**
   Invariant 8ac says the engine reads the Chinese. For Japanese it is the other way round,
   because the engine reads kana and *refuses kanji* — 8h: a kanji's reading depends on the
   word, and this product has no Japanese dictionary. The model brought one, keyed by surface
   form: 今日 is `ky o`, 日本 is `n i q p o N`, 私 is `w a t a sh i`. So here the lexicon can
   say something the engine cannot, and 8ac's argument that both voices should read a line the
   same way does not apply: the built-in voice cannot say the line at all.

   The Japanese path therefore does **no** number spelling — the lexicon has 1, 10, 100 as keys
   of its own, and 二零二六 is not Japanese — and no `[...]` overrides, which carry pinyin. It
   is a greedy longest match over code points, longest key first, and a character with no entry
   is reported rather than guessed.

   **Which language a line is depends on the model the user chose, not on the characters.** Two
   rows in the voice menu, two folders under `%LOCALAPPDATA%`, two entries in the tool's table.
   Nothing guesses, and `--provider` is refused rather than defaulted when it names a model the
   tool does not serve — a Japanese line rendered by the Chinese model reads as the model being
   bad rather than as the wrong model.

8ak. **The offline model's tuning is its voice, in the sense the cache key already
   understands.**
   A neural model has four knobs a provider's endpoint does not expose — which speaker out of
   the several in the weights, `noise_scale`, `noise_scale_w`, and `length_scale`. They were
   constants in `local_cli.cpp` until 3.4.0, so a package holding several speakers offered one.

   **Every one of them changes the sound, so every one has to be in the cache key**, or the
   cache hands back the previous setting's audio and the line simply does not change when the
   dialog is closed. They travel in `Params::voice`, which is already field three of
   `cache_material()` and which for a source that runs here means nothing else — the provider
   table fills it with the literal `"default"`. So the tuning *is* the voice, and
   `kCacheFields` did not move.

   **An eighth field was the first attempt and is the thing not to go back to.** It rehashes
   every entry including the three cloud providers', so the first Speak after an update
   re-fetches a line somebody has already paid for. 8ab says a purchase must not sit behind a
   keystroke; it must not sit behind an update either.

   **The defaults spell out in full, and 3.4.0 had this the other way round.** They spelled as
   an empty string so an untuned line kept its cache file. One release was enough to show why
   that is wrong: an empty spelling records *"whatever this build's defaults are"* rather than
   the numbers, so the moment a default changes, every entry already named that way claims a
   sound it does not contain — one line of a project cached, the next fresh, and the two
   different with nothing on screen to say why. A default did change in 3.5.0, which is how it
   was noticed. Spelling costs one re-render per offline line: four seconds of CPU and no
   money, which is exactly the distinction that makes it affordable here and not for a
   provider. **A saving that changes what a key means is not a saving.**

   **Speed is inverted at the tensor, not in the dialog.** `length_scale` multiplies duration,
   so it runs backwards from what anybody means by speed. It had been pinned at 1 on the
   argument that the panel already has a Speed — which was wrong: the panel's Speed belongs to
   the *engine*, and an offline line is an imported WAV with the engine muted, so Speed never
   reached it at all. `ae-local-verify.jsx` renders the line twice and requires 0.5 to be the
   longer.

   **There are two spellers, and only one of them can read a C++ header.** The panel's is
   ExtendScript. `npm test` compares every limit and default against `cloud.hpp` field by
   field, and compares the panel's spelling against the worked example in
   `island_chatter_local --help` — which makes that example the wire format's one definition.
   The duplication is survivable in the way that matters: an unknown *name* is refused by the
   tool rather than ignored, so drift fails loudly on the first press.

   **The numbers are MeloTTS's own, and they were checked rather than inherited.** Upstream's
   `tts_to_file` defaults to `noise_scale=0.6, noise_scale_w=0.8, speed=1.0`. Until 3.5.0
   `variation` was **0.667**, which is sherpa-onnx's generic VITS default and arrived when this
   file still went through sherpa-onnx; dropping the library left its constant behind. Its
   fourth knob, `sdp_ratio=0.2`, is baked into the export and is not an input this model takes.

   **There is no speaker to choose, and that is checked three ways.** Upstream's config gives
   `spk2id = {"ZH": 1}` and `{"JP": 0}`; both ONNX files carry `n_speakers = 1` in their own
   metadata; and the `n_speakers: 256` in upstream's config is the **size of the embedding
   table**, not a count of voices. One trained voice each, 255 empty slots — which is exactly
   why an untrained index renders silence rather than failing. 3.4.0 offered a number box and
   caught the silence afterwards; 3.5.0 does not offer it. The field stays on the wire for a
   model that does have more than one, and because it is what lets the refusal name a number.

   **A speaker the model does not have renders silence, and the tool has to hear it.** Measured
   on the shipped Chinese package: 0 and 2 both come back the right length, the right rate, and
   peaking at 1 of 32767. Nothing in that chain is an error. A silent WAV imports cleanly, sits
   on the timeline, animates no mouth, and is indistinguishable downstream from a line the
   analyser found nothing in, so the message the user gets would be about their text. `speak()`
   therefore measures the waveform it is about to write and refuses below `kAudibleFloor`,
   naming the speaker. This is 8aj's rule — an option that appears and then fails reads as the
   feature being broken — applied to a number the user typed rather than to a row in a menu.

   **The dialog is a preset menu, three sliders and an audition, and each is load-bearing.**
   3.4.0 was four decimals in four text boxes under a paragraph explaining them, which is not a
   choice anybody can make. Only the first preset carries authority — it is MeloTTS's published
   defaults and `npm test` compares it against `cloud.hpp` — and the rest are this product's own
   starting points, which is why picking one immediately shows its numbers on the sliders and
   moving a slider drops the menu to Custom. The audition renders through the real model into
   the **temp** folder, never beside the project: it must work with no project open, which is
   precisely when somebody is setting a voice up (8af). Playback is
   `island_chatter_bake --play-hex`, because winmm and `SND_NODEFAULT` are already there and a
   second copy would be a second place to forget the flag that stops a failure sounding like
   a success.

8ah. **Custom timbre is a vocal tract, not a recording, and what is not measured is derived.**
   Five vowels, F1 and F2 each, measured from recordings the user makes. They replace the
   engine's table for a, e, i, o, u; everything else about the voice is still the engine, which
   is why this is not sample playback — samples cannot bend to a Mandarin tone contour, and
   that was the reason sampled voices were rejected in the first place.

   F3 follows F2's ratio and the bandwidths follow their own formant, because a third formant
   measured from a phone recording is mostly noise and an unreliable number is worse than an
   honestly derived one. The three Mandarin-only vowels follow the average of what was
   measured, or two speakers end up in one mouth. Ratios are clamped: a recording of a cough
   should make a strange voice, not an inaudible one.

   Zero means "not measured" and the engine's own value stands, which is what makes a
   half-finished session harmless and what makes a project saved before 3.2.0 sound exactly as
   it did. **Three states, and the middle one is the one that gets lost:** settings carrying no
   `customVowels` leave the layer alone, an *empty* array clears it, and values write it. The
   melody made the same distinction in 1.7.0 (8t); collapse the two and either Clear does
   nothing or Import wipes a voice somebody recorded.

8ai. **The trial signs its audio, and the limit lives in the engine.**
   Everything works in a trial build; the engine adds a quiet two-note chirp every four
   seconds. A layer limit would stop anybody judging whether twenty lines hold together, and a
   time limit means nothing to a product whose unit is a two-second line — so the trial renders
   everything and signs the result.

   It goes in **before the limiter**, which the DSP suite established by failing ("an extreme
   Volume clipped") when it went after: a watermark that clips damages the thing it is
   watermarking. It is a pure function of the absolute sample index, so the lazy renderer and
   the eager one stay bit-identical (8d), and **both** output paths add it — one of them alone
   is a build that signs its previews and not its exports.

   The panel cannot enforce any of this: it is plain text, and a limit written in ExtendScript
   is a limit anybody deletes with Notepad. What the panel does is *say* so, because somebody
   who does not know about the mark is somebody deciding the synthesizer is broken; it asks
   `island_chatter_bake --build`, which knows because the answer is compiled into it.

   `tools/package-release.ps1` reads the token out of every staged binary and refuses **both**
   directions: a release carrying the trial token would sign audio somebody paid for, and a
   trial package that is not actually a trial build gives the product away. A check in one
   direction only is how the other one ships.

   **The .aex has to carry the token itself, and only does because the About box says it.**
   Nothing else in the plug-in called `build_kind()`, so the linker dropped the string and the
   first run of the packaging check found the one file that renders audio in After Effects
   carrying neither token. The packager now names it specifically rather than trusting a count.

   **One measured consequence, in the trial only:** the analyser scores vowel colours against
   audio the engine rendered, and a tone burst inside a vowel changes the spectrum it is
   identified from. `analysis_tests.cpp` therefore skips that one score in a trial build and
   says why. Syllable *timing* is unaffected, which is what the mouth is driven by.

8aj. **The menu offers what runs; the manager lists what exists.**
   `--providers` answers "what can be offered today" and lists only installed models, so that
   nothing in the voice-source menu fails when it is pressed. `--models` answers "what is
   there", installed or not, and is what the Offline models window reads.

   Both answers are needed, and 3.2.0 shipped only the first: its download button fetched
   whichever offline row was selected in the menu, and the menu could not show a model that was
   not installed yet. So the first press anybody ever made said "choose one in the menu first"
   with nothing to choose — a dead end reachable by every new user, and one no test caught
   because every test ran on a machine where the model was already there.

   The rule that produced it is still right: an option that appears and then fails reads as the
   feature being broken. What was wrong was answering a question about the catalogue with the
   menu. **When a list is filtered for a reason, something else has to be unfiltered**, or the
   thing being filtered out becomes unreachable.

   Downloading names the model (`--install --provider`), removing names it too, and removing
   asks first — 177 MB is twenty minutes to get back. A removal deletes only the files the tool
   fetched and leaves the folder if anything else is in it: a wildcard delete of a path built
   from a string is how the wrong folder gets emptied. After a download the new source is
   *selected*, because somebody who has just spent twenty minutes on a model should not have to
   go and find it.

   **And the button that speaks says which kind of voice it will use.** "Cloud voice" over an
   offline model contradicts the one thing that matters about that model, on the control the
   user is about to press. Relabelling at run time means resetting `preferredSize` (8z), or the
   longer label is drawn into the shorter one's box and comes back as an ellipsis.

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

8aa. **A recording is a plan too, and that is the whole of the lip-sync design.**
   `--analyse` reads a WAV or AIFF and prints the format `--plan` prints, byte for byte, so
   `parseEnginePlan()`, markers, `mergeRigTimeline()`, the mouth switch and Fit Duration were
   not touched to support it. Anything that makes the two formats diverge costs all of that.

   An audio line has **no native effect**, which is what every other part of this file uses to
   recognise one of its own. It carries `IC Audio Line` and `IC Audio Vowels` instead — the
   settings it was analysed with, so Rebuild reproduces the same plan rather than quietly
   making a different one from whatever the panel happens to be showing now. `rigMembers()`
   accepted only text layers until 2.3.0; that is the line to check first if an audio line
   stops reaching the rig.

   `planWithinLayer()` exists because the plan describes the file and the layer may be using
   part of it: `start` is `startTime`, not `inPoint`, and the events outside the trim are
   dropped rather than left to open the mouth over audio nobody can hear. Time stretch is
   **refused**, because nothing in the analysis measures it and accepting it would put every
   shape wrong by the stretch factor while looking exactly like the feature not working.

   Silence produces no events, so the pause rule in 8x closes the mouth without anything here
   knowing about mouths. That is the load-bearing part of using the same format.

   `parseEnginePlan()` divides by the rate the plan **states**, never by `ENGINE_SAMPLE_RATE`.
   For a spoken line they are the same number because the panel passed it; for a recording
   they need not be, and a 44.1 kHz plan divided by 48000 drifts 9% further out with every
   syllable and shows nothing on screen to say why.

   The accuracy is measured, not asserted: `analysis_tests.cpp` renders a line with the engine,
   analyses the result, and scores it against the plan the engine knows is right — 19 of 19
   syllables within 7-14 ms, and 68% of vowels. Vowel identification is a guess from a spectrum
   and is allowed to be wrong; it is not allowed to get quietly worse.

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

   **Observed once, on 2026-08-13, and not yet understood:** in an After Effects session that
   had already run five host suites, the retry failed as well and `ae-bake-test.jsx` reported
   "cannot open the output file for writing". The same suite passed immediately in a freshly
   started After Effects. So the purge appears not to release the handle reliably late in a
   long session. That is one observation and not a diagnosis — do not add a workaround on the
   strength of it, and do re-run the bake and cloud suites in a fresh host before concluding
   anything from a bake failure.
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

   **A label is not the only thing the panel says.** Everything it says at *runtime* goes
   through `M()`, which takes the same `"English / 中文"` key and fills `{0}`..`{2}`. The
   placeholders are the point: written as `"已唱出 " + n + " 句"` the count sits between two
   Chinese fragments and a translation has nowhere to go, which is why forty status lines,
   twenty-five alerts, the confirm, both prompts and every readout still showed Chinese in an
   English panel as late as 1.11.0. `H()` does the same for tooltips, from `IC_HELP` — a
   paragraph per language keyed by a short id, because three explanations do not fit in one
   bilingual literal, and `tip()` registers each one so a language switch reaches it.

   **简体中文 is computed, not written.** `simplify()` converts the Traditional half: terms
   first, then characters. Duplicating 163 messages and 29 tooltips into a fourth table would
   drift the first time one was reworded, and every future message would need two Chinese
   versions or silently have none — this way a new message is Simplified for free. Traditional
   to Simplified is the safe direction, being many-to-one.

   The terms exist because a character map alone gives Simplified characters spelling *Taiwan*
   terminology: 算圖佇列 becomes 算图伫列. Longest term first, so 專案檔 becomes 项目文件
   before 專案 becomes 项目. The one context-dependent character is 著 — 着 as a particle,
   which is every use here, but 著 in 著名; a message needing that sense needs a term entry.

   What can rot is coverage, and it rots invisibly: an unmapped character reaches a Simplified
   reader still Traditional and nothing looks broken enough to notice. So every Han character
   the panel can show must be *classified* — in `IC_SIMPLIFIED_CHARS`, or in the
   `identicalInBothScripts` list in `tests/validate-script.js`. A new character fails until
   somebody says which.

   The check that let this ship ran one way only: every key in the table had to still be
   somewhere in the panel. A *new* message was therefore never in the table and never
   checked. `npm test` now also runs the other way — every `M()` key must have a Japanese
   entry, the placeholders must agree across all three languages, no message-bearing line may
   carry a bilingual literal outside `M()`, no bare Chinese may reach a readout, and every
   tooltip must have three bodies with the English no shorter than the other two. Do not add
   a message by concatenation; the guard exists because that is how every broken one was
   written.

   **A label had no such check until 2.2.0, and the hole was the same one.** Messages and
   tooltips were made two-way; plain labels were left one-way, so a label that never had a
   translation was never asked about — deleting a tab title's Japanese entry changed nothing
   `npm test` could see. Every `"English / 中文"` literal outside `IC_JAPANESE_UI` and
   `IC_HELP` now needs an entry, which on arrival found `"Saved / 已儲存"` untranslated since
   1.0.2.

   That check has to read the panel with `stringLiterals()`, the sibling of `stripLiterals()`,
   for the reason invariant 2 gives: a regex over the raw source pairs a quote inside a
   comment with a quote in code, and a scan run over slices of the file spliced back together
   goes out of step at every seam. Both were tried. The spliced version found twelve bilingual
   strings in a panel that has 168 and reported that none of them were missing anything, which
   is why the count has a floor under it.
8z. **ScriptUI measures a control once, and the panel is as wide as its widest row.** Two
   separate consequences, both of which shipped.

   Writing a longer string into `.text` afterwards draws it into the old box and After
   Effects renders the overflow as an ellipsis, so the first Japanese panel came back reading
   `中央ぞ…` and `台本を読み…` *with empty space beside it*. Nothing was too narrow; every
   label was still wearing the Chinese label's measurements. `relabelUI()` therefore resets
   `preferredSize` to `[-1, height]` on everything it relabels, plus every group and every
   dropdown whose items changed. The height is carried over because Apply is deliberately
   34 px tall. `icFixedWidth` marks the slider titles, which are pinned to 110 so the sliders
   share a column and must survive a language change.

   Separately, a row is as wide as everything in it, and the sing row held eleven controls:
   762 px in Chinese, 817 in Japanese, against the 414 the text box asks for. It had been the
   widest thing in the panel since 1.7.0 and nothing measured it. Shortening the words was
   never going to reach 414 from 762, so the wide rows are split instead — one line of height
   each. `ae-language-verify.jsx` fails if any row needs more than 460 px in any language.

   Two traps in measuring this. A row's own `preferredSize` reports the panel's width, not
   its content, because `alignChildren` stretches it — sum the children instead. And
   `preferredSize.width` on an **empty** `statictext` is silently ignored, so the readouts
   measure as nothing until they have something to say; fill them with their own text before
   measuring, not another readout's, which is a mistake that cost a spurious 493 px.

   The language picker is left-aligned and must stay that way. Aligned right its position is
   measured from the widest row, so it moved every time the language did and left the panel
   entirely in a narrower dock — the one control that must never become unreachable.

   **Height is the same problem and went unmeasured for far longer.** By 2.1.0 the panel was
   forty rows in one column asking for 414 x 1354 px, and a docked ScriptUI panel in After
   Effects does not scroll — it clips. On an ordinary dock the missing third was Apply,
   Re-sync, Re-flow, Bake, Remove and the status line: every verb the product has. From 2.2.0
   the settings live on four tabs and the verbs do not, so they stay reachable from any page.
   The limits are `TALLEST_PANEL` 800 and `TALLEST_PAGE` 570 in `ae-language-verify.jsx`,
   both derived from the ~900 px a 1080p dock gives; a page that will not fit is split into
   another page, which is the same answer a row that will not fit gets. 2.2.0 measures
   732 x 447 with the Speak page at 504.

   **The width guard nearly went blind at the same moment, and that is the part worth
   remembering.** It iterated `built.children` once, which was every row while the panel was
   one column and is four tab containers now. It would have measured nothing, found nothing
   over 460, and passed — the identical shape to the one-way translation check in 8i. Both
   walks are recursive now, and a too-wide row planted *inside* a tab was confirmed to fail
   before any of this was believed.

   Two more things measuring it taught. A tabbed panel is as wide as the wider of its widest
   page and its strip of titles, so the control itself has to be measured or the strip is
   never accounted for at all; it is currently the widest thing in the panel at 447 px. And a
   single very long label cannot breach the width limit — ScriptUI clamps one control — so
   the only way to overflow a row is still to put too many controls in it, exactly as the
   eleven-control sing row did.

   **Two pages from 3.6.0: the line, and the voice.** The first page is the line and what
   moves on screen — text, pronunciation, tempo, Preview, the rig, the mouth switch, Type-On,
   the markers, importing a script. The second is the voice: the thirteen effect parameters,
   the saved characters, and the three other ways audio arrives (MIDI, a recording, a cloud or
   offline model).

   It started from a sharper rule — *can you do this anywhere else?* — and that rule is why the
   parameters are on the second page: every one of them exists again in Effect Controls once a
   line is applied, where it can be keyframed and where anybody working on that layer is
   already looking, so the panel's copies matter only until the first Apply. What the rule
   could not decide on its own was MIDI, lip-sync and the voice sources: none is a parameter,
   all are the voice. **A saved character is those thirteen parameters under a name**, so it
   sits beside them — picking one moves every slider on the page, which is only legible if the
   sliders are in sight.

   Custom timbre stays on the *first* page even though it writes parameters `279-289`: the
   parameters are visible in Effect Controls, but *measuring a vowel from a recording* is not
   something Effect Controls can do. The test is what the control does, not what it writes.

   **The balance is measured, and so is what it costs.** On the parameter rule alone the pages
   came out **968 and 396** — the second a third full, the first needing limits well past what
   a 1080p dock gives. Moving those ten rows across gives **628 and 736, panel 964**, so
   `TALLEST_PAGE` and `TALLEST_PANEL` are **780 and 1010**, one row of headroom each. That is
   still ~60 px over a 1080p dock: on one that short the bottom of the *second* page clips,
   which is the offline-model row. The verbs 2.2.0 lost are outside the tabbed panel and cannot
   be reached by this. Three pages is what buys the last 60 px back, and three pages is the
   arrangement being replaced. The guard was confirmed still live by setting the page limit
   under the measurement and watching it name the page and the number.

   Two seams this leaves, both deliberate and both one line to change. **Tempo** is on the
   first page and writes the **Speed** slider on the second; its readout prints the Speed it
   computed, which is why it is a seam rather than a break. **Preview** is on the first page
   and the sliders it previews are on the second.

   **A label names what moving it does, not the mechanism behind it.** Type-On's ease slider
   read `Leave / 離開` until 3.7.0 — the temporal ease influence on the outgoing side of each
   keyframe, which is exactly right and tells a user nothing. It is `Ease / 緩動` now, beside
   `Smoothness / 平滑`, so the pair says which of the two motions each one is about.

   `remeasure()` resets **both** axes on a `tab` and a `tabbedpanel` rather than carrying the
   height over. Apply's 34 px is a deliberate number and is kept; a page's height is whatever
   its content needs, and pinning it to the language the panel was first built in is the same
   bug as pinning a label's width.
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
8ad. **One function fits a line to its plan, and it writes down what it overwrote.**
    Fit Duration changes `outPoint`, and until 3.1.0 nothing recorded the previous value — so
    Remove stripped everything else off a layer and left it at the engine's length, with no way
    back once the session closed. `fitLayerToPlan()` is now the only place that fits a line, and
    it records `outPoint - inPoint` in an `IC Original Length` control the first time it touches
    a layer; `removeFromLayer()` puts it back and takes the control with it.

    A **length**, not an out point: Re-flow moves lines by shifting `startTime`, and an absolute
    out point restored after a move puts the layer back where it used to be rather than back to
    the length it used to have. Written only when there is no record, or the value saved is
    whatever the previous Apply left, which is the engine's number and not the user's. Read
    *before* the effect-removal loop, because AE invalidates the handle (invariant 3).

    `clampToComp` is the argument that keeps 8o's distinction: Apply clamps to the composition,
    the operations that lay out time grow it first. `npm test` counts the `.outPoint =`
    assignments in the panel and expects exactly three — the fit, the restore, and the rig layer
    being grown to cover its members. A fourth is a line that can be fitted without its length
    being recorded.

8ae. **A line records which character it was given, on the line.**
    A character used to exist only as a shared rig, so a line that was unbound — or that drove
    its own sliders — had eight numbers and no name. The name now goes in the native effect's
    *display name*: `Island Chatter Voice · 咪咪`. Not a new control, because the layer's
    `comment` is the user's, a marker would sit among the timing markers and a slider cannot
    hold a string; `findEffect()` matches `matchName` first, so a renamed effect is still found.

    The rig's name wins when there is one — the pointer is what disappears, and that is exactly
    when somebody wants to know who was speaking. Without a rig it falls back to the panel's
    character, and **only when the sliders still match it**: a name on a line that no longer
    sounds like that character is worse than no name, because it is believed. A built-in is
    stored by the English half of its `"Mimi / 咪咪"` label, or the same line reads as two
    different characters in two interface languages (invariant 8i, on a record that outlives the
    session). It is written on every Apply, including as an empty string, and `npm test` checks
    the brace depth of that assignment rather than its presence — wrapped in `if (character)` it
    still matched a search, and that is precisely the bug.

8af. **Preview touches nothing.** It renders with `island_chatter_bake` to one fixed file in the
    temp folder and asks Windows to play it: no layer, no import, no undo step, and therefore
    none of invariant 8g's purge. `voiceArguments()` is the only command builder, shared with
    the layer path through `settingsFromEffect()`, so the voice previewed is the voice applied.

    **PowerShell does not run from inside After Effects, and that is measured rather than
    assumed.** The obvious playback is a `Media.SoundPlayer` one-liner handed to
    `system.callSystem()`, and it works from a PowerShell prompt. Inside After Effects *every*
    PowerShell command returns an empty string in about 130 ms, having run nothing and written
    nothing — including `powershell -NoProfile -Command "'ALIVE'"`, and including the full path
    to `powershell.exe` — while `cmd /c echo` returns its output normally.
    `native/tests/ae-preview-probe.jsx` is that measurement; re-run it before believing any
    fix that reaches for a shell.

    So the engine tool plays it: `island_chatter_bake --play` calls `PlaySound` with `SND_SYNC`
    and `SND_NODEFAULT` — without the second flag Windows substitutes its own ding for a file it
    cannot play, which reads as success. It **closes the WAV first**, because PlaySound opens
    the file itself and cannot open one this process still holds open for writing; that failure
    looks exactly like "Windows cannot play this file". Doing it in the tool also puts the path
    back on the hex route every other path takes (invariant 8e), so a user folder with Chinese
    in it works. The reply is checked for `PLAYED`: `callSystem()` reports no exit status, so a
    failure otherwise looks exactly like successful silence.

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
8y. **Set the temporal ease before the interpolation type, never after.** After Effects 26
    puts a key back to bezier on both sides when `setTemporalEaseAtKey()` is called, so an
    interpolation type set beforehand is silently undone. `IC Accent` needs a step on one side
    of each key and a curve on the other, and written the obvious way round it came out as a
    ramp: the eases landed, both HOLD sides did not, and nothing threw — `setShapedKey()`
    swallows failures so an older host still gets the values, which is the same catch that
    hides the two traps in `setEasedKey()`.

    Nothing portable can see this. `ae-host-regression.jsx` reads the interpolation types and
    the ease influences back off the layer, which is how it was found.
8x. **The mouth shuts on a gap, not on a percentage — and that is now the default for speech
    too.** Until 1.9.1 every syllable closed at 82% of its length. On ten syllables of ordinary
    dialogue that is nineteen open-shut cycles with the mouth shut 41% of the frames, reported
    twice as the mouth "constantly cutting to the closed layer". From 1.10.0 a spoken line
    closes only where there is a pause, leaving five closes at the punctuation and the end.

    The old look is a panel tick, `mouthChatter`, and ticking it reproduces 1.3.0 key for key —
    `validate-script.js` still pins that path exactly, which is what invariant 8l asks for; the
    default path is pinned beside it. A sung line ignores the tick entirely, because there the
    short closes are sub-frame and that is a sampling artefact rather than a style.

    `mouthChatter` is a panel-wide preference read at the two places that build a rig, not a
    per-layer parameter: a scene with half its lines flapping and half legato is not a look
    anyone wants, and it would otherwise need an ABI slot. Nothing rewrites existing keys until
    the user presses Rebuild or Apply. Speaking, every syllable closes at 82%
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

The offline voice needs one more thing, referenced by path rather than vendored, exactly as the
AE SDK is. Unpack a Microsoft `onnxruntime-win-x64-X.Y.Z` release and configure with it, or
`island_chatter_local` simply does not appear — and `tools/package-release.ps1` refuses to cut a
release without it, which is also what stops a version being packaged from a tree that was never
configured for one:

```powershell
cmake -S native -B native/build -DISLAND_CHATTER_ONNXRUNTIME_ROOT="<unpacked onnxruntime-win-x64>"
```

Regenerating `native/generated/melo_phonemes.hpp` additionally needs the model itself, which is
not in the repository and is not downloaded by the build:

```powershell
node native/tools/generate-melo-phonemes.js `
    "$env:LOCALAPPDATA\Island Chatter\models\vits-melo-tts-zh_en\lexicon.txt" `
    native/generated/mandarin_readings.hpp native/generated/melo_phonemes.hpp
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
| `native/tests/ae-lipsync-verify.jsx` | Audio lip-sync end to end in the host: the layer joins the rig, the mouth opens and shuts, a trim drops the events outside it, and a time-stretched layer and a solid are both refused |
| `native/tests/ae-cloud-verify.jsx` | The cloud voice end to end, on a seeded cache so it spends nothing: the provider table, the import, the muted live effect, the plan read out of the recording, the stale rule handing it back to the engine, and Apply not re-fetching. It needs the project saved somewhere writable and does that itself |
| `native/tests/ae-language-verify.jsx` | Builds the real panel and switches it through all three languages: every table entry and tooltip, `M()`'s placeholders, and that a switch rewrites labels *and* tooltips on live controls. `npm test` checks the same layer in Node, which is not the engine that runs it |
| `native/tests/ae-audio-render.jsx` | Renders the effect to audio through the render queue |
| `native/tests/ae-text-animator-probe.jsx` | Diagnostic for the text-animator placeholder behaviour in invariant 3b |
| `native/tests/ae-rebake-probe.jsx` | Diagnostic for what releases an imported WAV, behind invariant 8f |
| `native/tests/ae-size-probe.jsx` | Diagnostic for invariant 8z: walks the panel and prints what every row and every column wants to be, wide and tall, in all three languages, control by control |
| `native/tests/ae-close-probe.jsx` | Closes a leftover project without saving, so the next suite can start. Run it between suites |
| `native/tests/ae-preview-probe.jsx` | Diagnostic behind invariant 8af: what `system.callSystem()` can and cannot run from inside After Effects. It is the measurement that says PowerShell returns an empty string in ~130 ms having done nothing, while `cmd /c echo` works — re-run it before believing any fix that reaches for a shell |

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

## Writing a guard

**A guard whose first run is a pass has not been tested; it has been written.** Break the thing
it guards, run it, watch it fail, then put the thing back. Every invariant above that says "was
broken once on purpose" means exactly that, and the reason the phrase keeps appearing is that
this project has shipped hollow guards repeatedly — the ES3 reserved-word check in
`validate-script.js` reported success while checking nothing from 1.4.0 onward, the width check
in `ae-language-verify.jsx` would have measured four tab containers and found no rows at all,
and the translation check could only ever catch a deletion, never an omission.

Two shapes account for almost all of them.

**Measuring a consequence instead of the mechanism.** A consequence has other causes, so it
survives the break: a seam guard compared each seam against the largest step *including the
seams*, and could not fail however bad the joins were; a harmonics guard measured brightness in
rendered audio, which moved less between builds than between two sentences. The fix is always
to assert the thing itself, which usually means exposing it — `Diagnostics`, or
`cache_material()`, which is public only so its fields can be counted rather than inferred
through the two collisions that happen to be reachable from `Params`.

**Searching source text for an identifier.** This one is specific to the guards in
`validate-script.js` that read `.cpp` and `.jsx` as text, and it bit five times in 2.4.0 alone:
the identifier survives the break because it also appears in the comment explaining it, in the
error message beside it, or in the branch the break just made dead. `WINHTTP_FLAG_SECURE`
replaced by `0` still matched, because the paragraph above it names the flag.
`if (false)` around the reply bound still matched, because the message inside says
`kMaxReplyBytes`. `onThisMachine: false` still matched a search for `onThisMachine`. So pin the
**use**, not the name: the call with its argument list, the comparison with both sides, the
field being read out of `fields[7]`. If a regex would still match after the protection is
deleted, it is not a guard.

The break-and-watch step is cheap here — `npm test` is seconds and `ctest` is seconds — and it
is the only thing that distinguishes a guard from a comment that happens to be executable.

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

