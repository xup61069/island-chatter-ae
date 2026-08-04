# Changelog

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
