# Changelog

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
