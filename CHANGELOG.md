# Changelog

## 1.2.0 - 2026-08-05

Japanese, and an interface that speaks three languages.

- **Kana is spoken as Japanese.** Unlike Chinese there is nothing to look up: the character
  is the pronunciation, so this needs no dictionary and nothing extra is installed.
  Handled: 清音・濁音・半濁音, 拗音 (きゃ is one mora written with two characters), 促音 っ
  (a rest, not a sound), 撥音 ん (a mora of its own), 長音 ー (holds the vowel before it),
  and small vowels after non-i kana so loanwords like ファイト and ヴァイオリン come out right.
  Katakana shares the table with hiragana.
- **A mora is timed like a Mandarin syllable**, so Tempo Lock lands Japanese on the beat too.
- **Kanji is deliberately not guessed.** The same character is read differently depending on
  the word around it, which needs a dictionary and a disambiguator. Unmarked kanji falls
  through to its Mandarin reading and the panel says so on the status line rather than
  letting it sound wrong quietly. Mark it instead: `[今日|きょう]はいい[天気|てんき]`.
- は and へ are read literally, because telling a particle from part of a word needs the
  same analysis: こんにちは is wa but おはよう is ha, and nothing in the surrounding
  characters separates them. Four fixed greetings where there is no ambiguity are
  special-cased; everywhere else, mark it: `きょう[は|わ]いいてんき`.
- **The panel is available in 繁體中文, English and 日本語**, chosen from a picker at the top
  and remembered between sessions. It changes nothing about what is spoken.

## 1.1.0 - 2026-08-05

Timbre. Four new controls, all appended, all defaulting to what 1.0.x did:

- **Formant / 共鳴** scales the vocal tract, and so every resonance, without touching the
  pitch. This is the difference between a small creature and a large one, and it is the
  control that was missing: Pitch alone just makes the same character sing higher.
- **Timbre / 音源** replaces the vocal folds rather than the resonance. *Reed* is a
  sawtooth slope, brighter and buzzier. *Chip* keeps only odd harmonics, hollow and 8-bit.
  *Metallic* ring-modulates against a fixed inharmonic carrier. *Granular* chops the vowel
  into grains. *Growl* adds a sub-octave partial underneath.
- **Vibrato / 顫音** and **Vibrato Rate / 顫音速率** were fixed at the voice preset's own
  depth and a hardcoded 9.2 Hz.

Fixed alongside them:

- The additive source now uses as many harmonics as it takes to reach the third formant,
  instead of a flat twelve. Twelve harmonics of Cozy's 176 Hz fundamental stop at 2117 Hz
  while its third formant sits at 2494 Hz, so the formant that gives the voice its
  character had nothing to resonate. Elder was worse. **Low voices will sound brighter and
  more distinct than they did in 1.0.x**; measured on the same phrase, Cozy gains 1.4 dB
  around the third formant and 2.8 dB above it, Elder 2.0 dB and 2.3 dB. Voices at 245 Hz
  and above are unchanged to within 0.1 dB, because twelve harmonics already reached them.

## 1.0.11 - 2026-08-05

- The panel no longer works out its own syllable timings. It asks the engine, through a new
  `island_chatter_bake --plan`, and uses the answer for markers, the rig, Type-On and Fit
  Duration. Reading the arguments off the effect means the plan describes the audio that
  will actually render.
- This fixes timings that were wrong, not just untidy. The two implementations could not
  agree even in principle, because the engine varies each syllable's length by a seeded
  random amount, so ordinary Chinese drifted by up to 10 ms. Worse, the panel's copy knew
  nothing about inline overrides, Zhuyin, tone-number pinyin or the 64-unit truncation:
  `[重|chong2]新開始` planned twelve syllables against the four that are spoken and sized the
  layer 1.28 s too long, and `ni3 hao3 ma5` planned seven against three.
- 243 lines of duplicated planning leave the panel, along with its 473 KB copy of the
  Mandarin reading table, which is no longer installed. `npm test` fails if any of it
  comes back.
- Marker labels now come from the engine too, so a syllable that speaks more than one
  character is labelled with all of them.
- Fix Bake failing on any layer that had already been baked, which it has done since the
  feature shipped in 1.0.3. After Effects keeps the imported WAV open, so the file could
  be neither deleted nor rewritten. A probe against After Effects 26 established that
  removing the layer does not release it and neither does removing the footage item; only
  a purge does. The panel now renders first and only releases the old bake if the write
  actually failed, so a first bake is unaffected and a re-bake costs the undo history but
  keeps the RAM preview.
- Re-baking replaces the previous baked layer instead of stacking another copy of the
  voice on the timeline.

## 1.0.10 - 2026-08-05

- Cut the extracted package from nine items to four. `Install.bat`, `Uninstall.bat`,
  `README.txt` and `LICENSE` are all that is visible; the plug-in, the bake tool, the panel,
  the readings table and the install scripts move into `resources\`. Nine items with three
  plausible-looking `.aex`/`.jsx` files in the middle left first-time buyers guessing which
  one to open.
- `Install-IslandChatter.ps1` now searches for its payload instead of assuming it sits one
  directory up, so it works from the new layout, the old one, and the repository.
- `README.txt` is the only instruction a buyer gets: UTF-8 with a BOM so Notepad renders the
  Chinese, CRLF pinned in `.gitattributes`.
- `npm test` checks the package layout itself — every payload file must be staged into
  `resources\` and must not also appear at the top, and the launchers must look there.
- Refuse to encode a version that does not fit `PF_VERSION`'s bit fields. Bug has four bits,
  so 1.0.16 would encode identically to 1.0.0 and After Effects would read the upgrade as a
  downgrade.

## 1.0.9 - 2026-08-04

- Add `Install.bat` and `Uninstall.bat` at the top of the release package, so installing is
  a double-click and a UAC prompt rather than opening PowerShell and knowing about execution
  policy. They request elevation themselves, refuse to run while After Effects is open, and
  hold the window at the end so a failure is readable instead of vanishing.
- Both launchers stay ASCII. A `.bat` is read in the console code page and has no BOM to
  declare otherwise, so the bilingual messages come from the PowerShell script they call.

## 1.0.8 - 2026-08-04

- The Type-On reveal now follows the same curve as the recentring glide instead of using
  hold keyframes. This is what makes Smoothness do anything: with hold keys the selector
  edge jumped instantly and there was nothing to soften. The trade-off is that characters
  now fade in around their syllable rather than popping exactly on it.
- Drop the Arrive slider. The arriving side is pinned to full influence so motion always
  settles rather than stopping dead, leaving Leave as the single shape control for both the
  reveal and the glide.
- Smoothness is a slider rather than a fixed 0, defaulting to 40. Because it is now a panel
  control it is written on every Apply.

## 1.0.7 - 2026-08-04

- Replace the Type-On centring curve dropdown with two sliders, Leave and Arrive, which are
  the same pair of influences After Effects exposes on a keyframe. The default is still
  fast-to-slow: leave at full speed, decelerate into place. Setting both low gives near
  linear motion, so nothing was lost with the preset list.

## 1.0.6 - 2026-08-04

- Add a curve control for the Type-On recentring glide, defaulting to fast-to-slow so the
  line leaves at speed and decelerates into place. Slow-to-fast, smooth and linear are also
  available, and because these are ordinary keyframes the shape can still be reworked in the
  Graph Editor afterwards.
- Fix the easing added in 1.0.5 never actually reaching the keyframes. Two silent failures
  compounded: reading `value` on a text animator's Position throws "invalid numeric result",
  and Position is a spatial property, which takes exactly one temporal ease rather than one
  per dimension. Both threw after the interpolation type had already been set, so the keys
  looked eased while carrying no ease, and the motion was the symmetric slow-fast-slow shape
  After Effects applies by default.

## 1.0.5 - 2026-08-04

- Add Center to Type-On. The opacity-based reveal does not reflow the text, so on a
  centre-justified layer the visible run grew out of the left edge and the line looked
  like it was sliding right. Reflowing would mean keyframing Source Text, which the panel
  reads back as the authority on what to speak, so instead the width of each partial
  string is measured once at Apply time and a second animator offsets every glyph by half
  the width still to come. The offset reaches zero on the last character, so the finished
  frame is exactly the layout After Effects would have produced on its own.
- The recentring uses eased keyframes rather than holds, so the line glides into place
  instead of jumping sideways on every character.
- Remove now also clears the centring animator.

## 1.0.4 - 2026-08-04

- Fix Tempo mode drifting with the character. The tempo sets how fast syllables should
  arrive, but the engine multiplies Speed again by emotion and character size, and the
  panel was not dividing that back out. Sleepy ran 28% slow, Scared with a Tiny character
  19% fast, and only Neutral and Question at Adult size were ever on the beat, because
  those are the combinations whose multiplier is 1. Verified against the engine across
  112 tempo, emotion and size combinations: worst error is now 0.001%.
- Recompute the tempo-derived Speed when emotion, character size, a preset or Randomize
  changes any of them, and stop the panel's own writes to the Speed slider from being
  mistaken for a manual drag and switching tempo mode off.
- Add Read selected layer: pulls the layer's text and, when Island Chatter is already
  applied, every voice setting back into the panel. A tempo-locked layer stores only the
  resulting Speed, so the BPM is derived back from it and round-trips exactly.
- Relicense from MIT to a source-available licence. Builds are sold, and MIT explicitly
  permitted anyone to compile and redistribute or sell them. The source stays public and
  buildable for personal use, including paid client work; passing a build to someone else
  is what is no longer permitted. Releases v1.0.0 to v1.0.3 remain MIT for anyone who
  obtained them.

## 1.0.3 - 2026-08-04

Performance:

- Synthesize only the syllables each requested audio block touches, instead of the
  whole utterance every time. Planning an utterance now costs about 0.6 ms rather
  than a 60-135 ms stall on the audio thread, which is what made scrubbing and
  slider drags stutter. The audio is bit-identical to a single full render.
- Volume is applied as a gain when samples are copied out rather than baked into
  the synthesis, so it is no longer part of the cache key. Moving the Volume slider
  costs 0.04 ms instead of 63 ms. Volume above 100% is now genuinely louder rather
  than being squashed by the saturation stage, and a soft limiter keeps the output
  below full scale. **A project left at the default 78% renders bit-identically to
  1.0.2; other Volume values will sound slightly different.**

Panel:

- Add a Bake command. It writes the voice to `Island Chatter Audio` beside the project file
  and imports it as an audio layer, then mutes the live effect so nothing is heard twice.
  Bake is handled by a new `island_chatter_bake` tool built from the same sources and
  installed beside the plug-in, so it does not involve the render queue, output-module
  templates, the work area, or any other layer, and finishes in a few hundred milliseconds.
  Paths and text reach the tool as hex UTF-8; passing them as plain text flattened them to
  the console code page, so a Chinese layer name produced `?????.wav` and failed to write.
- Add a Remove command that takes off the effect, the Tone bootstrap, the rig sliders, the
  `IC:` markers and the Type-On animator in one step, leaving effects the user added alone.
- Character presets can now be named, kept several at a time, and deleted. Previously there
  was a single unnamed slot whose Load button only appeared after reopening the panel.
- Default the Type-On range selector's Smoothness to 0 so each character lands cleanly
  instead of ramping in. Only After Effects' own default of 100 is replaced; any other value
  is left alone.

Tempo:

- Add Tempo mode to the panel: enter a BPM and how many syllables fall on each beat,
  and Speed is derived as `BPM x syllables_per_beat / 300`. Dragging Speed by hand
  switches tempo mode back off.
- Add a Tempo Lock parameter (index 76, appended). It removes the per-syllable length
  jitter and rounds punctuation rests to whole syllable slots, so every syllable lands
  exactly on the beat. Verified on the grid to within 0.03 ms across 60-174 BPM at 1,
  2 and 4 syllables per beat. Projects saved before 1.0.3 get its default of off and
  keep their existing timing.

## 1.0.2 - 2026-08-04

Timing and animation:

- Fix markers, the animation rig, Type-On, and Fit Duration ignoring the extra Speed
  scaling that emotion and character size apply. Sleepy previously planned a layer
  28% shorter than the audio, so the end of the sentence was cut off.
- Match the panel's text planning to the engine for CJK brackets, `、`, `—`, `…`,
  surrogate-pair characters, and tone sandhi, removing phantom markers and mouth
  shapes and correcting the `IC Pitch` tone track.
- Report the 64 UTF-16 unit limit against each layer's own Source Text instead of the
  panel's text box, so long text can no longer be truncated without warning.

Mandarin readings:

- Read `〇` instead of skipping it as punctuation.
- Add full-tone phrase readings for 過, 著, and 了 words such as 過去, 經過, 難過,
  著名, 顯著, and 了解, which were previously flattened to a neutral tone.
- Keep 一 in its first tone as an ordinal, in dates, and inside digit sequences
  (第一名, 一月, 二〇一九).
- Treat `—` and `…` as pauses; they previously produced a chatter syllable.
- Accept `u:` as well as `v` for ü in numbered pinyin (`nu:3`, `lu:4`).

Audio:

- End the nasal consonant envelope with the syllable onset. ㄇ and ㄋ syllables ran
  the murmur at full amplitude for the whole syllable, about 25% louder than
  comparable syllables.
- Drop an unpaired surrogate split by the 64-unit limit instead of emitting a noise
  syllable.
- Snap animated voice parameters to their slider precision and bound the synthesis
  cache by memory (128 MB) rather than entry count.

Wider controls:

- Widen the voice parameter ranges. Speed now reaches 10 (typed values are accepted from
  0.10, and the engine clamps at 12 after emotion and character size scaling), Pitch spans
  0.10 to 4.00, Volume reaches 200%, Consonant reaches 6.00, and Seed reaches 999999.
  Widening a valid range cannot invalidate a saved project, and every default is unchanged.
- Drop harmonics above the Nyquist frequency instead of letting them fold back as aliasing.
  Nothing changes at normal pitches; it makes the top of the new Pitch range usable.

Panel safety:

- Fix Type-On always failing with "the property or a parent property is hidden". After
  Effects reports all 103 possible properties as children of a text animator's Properties
  group whether or not they have been added, `numProperties` stays 103 either way, and
  `canAddProperty()` returns true either way, so no existence test can succeed. The panel
  therefore never added Opacity and then wrote to the hidden placeholder. It now adds
  unconditionally, which is idempotent. Present since 1.0.0; Type-On is off by default,
  which is why it went unnoticed.
- Do not adopt, rename, or clear the keyframes of a Tone effect the user added.
- Require both the match name and the panel's own name before the legacy cleanup
  deletes a layer.
- Guard Type-On's Opacity and Range Selector End against keyframes, and reacquire the
  animator group after each `addProperty()`.

Release and tooling:

- Ship as `PF_Stage_RELEASE` instead of `PF_Stage_DEVELOP`.
- Derive the About text from the version macros.
- Sort installer version discovery by release year, refuse hosts older than After
  Effects 2025, and explain when elevation is required. Uninstall now cleans every
  installation that actually has the plug-in.
- Run the native DSP and cache tests in CI, and check version synchronisation, the
  76-slot parameter ABI, and the shared panel/engine tables automatically.
- Reject ES3 reserved words used as identifiers in any `.jsx`. After Effects refuses such a
  file with a modal "Illegal use of reserved word", which no automation can see.
- Add scripted After Effects host suites covering effect-stack order, repeat Apply, handle
  invalidation, a user-owned Tone, non-text layer types, batch apply, Type-On, and a render
  queue audio render. Against After Effects 26.0 the rendered audio correlates at 1.0000
  with zero lag against the engine's own output, confirming sample offsets, mono-to-stereo
  copying, and the absence of block dropouts.

## 1.0.1 - 2026-08-03

- Fix repeated Apply failures when generated rig sliders already have keyframes.
- Reuse one cold-cache synthesis across concurrent AE audio blocks to prevent first-preview dropouts.
- Skip unchanged effect parameters to avoid unnecessary audio-cache invalidation.

## 1.0.0 - 2026-08-03

- Add a native Windows x64 After Effects audio effect that runs directly on text layers without generated audio files.
- Add Mandarin planning for Traditional and Simplified Chinese using 44,355 Unihan readings.
- Add Mandarin initials, finals, aspiration, retroflex/sibilant contrast, diphthongs, nasal codas, tones, punctuation timing, and sentence intonation.
- Add third-tone, 一, 不, and common neutral-tone sandhi plus phrase-level polyphone readings.
- Add numbered-pinyin, Zhuyin, and inline pronunciation overrides.
- Add eight voices, seven emotions, four character sizes, clarity, cuteness, consonant emphasis, and deterministic seed controls.
- Add character presets, randomization, and saved custom presets.
- Add multi-layer application, duration fitting, `IC:` timing markers, five animation-controller tracks, and optional Type-On animation.
- Add a Windows installer, uninstaller, release packager, portable DSP tests, AE panel validation, and open-source documentation.
