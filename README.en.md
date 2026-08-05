# Island Chatter AE

[繁體中文](README.md) · **English** · [日本語](README.ja.md)

Give an After Effects text layer its own original, game-style character voice. No audio files
to export — the sound is generated and previewed inside After Effects itself. Built primarily
for Chinese, including Bopomofo input, with Japanese and English supported too, and every
pronunciation adjustable.

> An independently developed procedural voice synthesizer. It uses, extracts and bundles no
> audio or assets from Nintendo or *Animal Crossing*.

## Features

- The effect goes straight onto the text layer; preview and render are computed live by After Effects
- 44,355 Unihan readings, Traditional and Simplified
- Mandarin initials, finals, aspiration, retroflexion, nasal codas, diphthongs and all four tones plus the neutral tone
- Third-tone sandhi, the 一／不 tone changes, common neutral-tone particles and frequent heteronyms
- Pinyin, Bopomofo and inline pronunciation overrides, e.g. `[重|chong2]新`
- Japanese kana spoken directly: 拗音, 促音, 撥音, 長音 and the small vowels of loanwords, no dictionary needed
- English syllabified a word at a time with stress: stressed syllables long, unstressed short and reduced
- Up to 128 UTF-16 units per layer
- Panel available in 繁體中文, English and 日本語
- 8 character voices, 7 emotions, 4 character sizes
- A Formant slider independent of pitch, so the same pitch can belong to a completely different size of creature
- 6 sound sources: Voice, Reed, Chip, Metallic, Granular, Growl
- Vibrato depth and rate adjustable separately
- Pitch (0.10–4.00), Speed (0.10–10.00), Volume (0–200%), Consonant strength (0–6.00), Clarity, Cuteness and a fixed random seed
- Locks to a BPM so every syllable lands exactly on the beat
- One-click Bake to audio; playback then costs nothing to compute
- Batch apply across several selected text layers
- Optional Fit Duration and `IC:` per-syllable timing markers
- Optional `IC Mouth`, `IC Volume`, `IC Pitch`, `IC Head Bounce`, `IC Blink` animation controllers
- Optional Type-On animation that leaves Source Text intact, with centring and smooth glide
- Ships no audio assets; the same settings always reproduce the same result

## Requirements

- Windows 10/11 x64
- Adobe After Effects 2025 or 2026 (verified on After Effects 2026)
- Permission to write into the After Effects installation folder

## Installation

The installer is sold on Gumroad: **[Buy Island Chatter AE](https://kadid.gumroad.com/l/IslandChatterAE)**

### Steps

1. Extract `Island-Chatter-AE-*-Windows-x64.zip`.
2. Close After Effects.
3. **Double-click `Install.bat`** and accept the User Account Control prompt.
4. Reopen After Effects and choose `Window > IslandChatterNativePanel.jsx`.

To remove it, double-click `Uninstall.bat`.

Extracting gives you four things, and only the first is meant to be opened:

```
Island-Chatter-AE-*-Windows-x64/
  Install.bat        ← double-click this
  Uninstall.bat
  README.txt
  LICENSE
  resources/         ← the plug-in and the install scripts; nothing to touch
```

`Install.bat` only elevates and runs `resources\Install-IslandChatter.ps1`. Both are plain
text and can be read before running. To do it yourself:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\resources\Install-IslandChatter.ps1
   ```

The installer targets the newest After Effects it finds; `-AllVersions` installs into every
version detected, and `-AfterEffectsRoot "...\Support Files"` names one explicitly.

### Manual installation

All four files are in `resources\`:

- Put `IslandChatterNative.aex` and `island_chatter_bake.exe` in `Support Files\Plug-ins\Island Chatter\`
- Put `IslandChatterNativePanel.jsx` in `Support Files\Scripts\ScriptUI Panels\`
- Restart After Effects

## Using it

1. Make a composition and a text layer, and type into it.
2. Select one or more text layers.
3. Choose a character, emotion and voice settings in the Island Chatter panel.
4. Tick Markers, Fit Duration, Rig or Type-On as needed.
5. Press **Apply to selected text layers**.
6. After editing Source Text, press Apply again to resynchronise the text, timings and animation.
7. Press **Remove** to strip the effect, the Tone, the controllers, the `IC:` markers and the Type-On animator in one go.

> Set Pitch, Speed and Consonant once rather than animating them. After Effects hands an audio
> effect one set of parameter values per audio block, so keyframing these resynthesizes the
> whole utterance on every block; animating Speed also moves every syllable, and the seams can
> be audible. Volume is exempt — it is a gain applied after synthesis, so it can be moved
> freely at no cost.

## Locking to a tempo (BPM)

Tick **Tempo**, enter a BPM and how many syllables fall on each beat, and Speed is derived
from it (`speed = BPM × syllables per beat ÷ 300`). Dragging the Speed slider by hand switches
tempo mode off.

Tempo mode also turns on the effect's **Tempo Lock**: the per-syllable length jitter is
removed and punctuation rests are snapped to whole syllable slots, so each syllable lands
exactly on the beat. Measured across 60–174 BPM at 1, 2 and 4 syllables per beat, the error
stays within 0.03 ms.

## Bake to audio

Press **Bake** and the voice is written to a WAV in an `Island Chatter Audio` folder beside
the project file, imported automatically as an audio layer under the original, with the live
effect muted so nothing is heard twice.

After baking, playback costs nothing to compute, the waveform is visible on the timeline, and
anyone without the plug-in can still hear the project. This does not go through the After
Effects render queue and touches neither the work area nor any other layer; it usually takes a
few hundred milliseconds. The project has to be saved first so the audio knows where to live.

The panel adds a zero-level built-in After Effects Tone to the same text layer as the sound
source, and `Island Chatter Native` then replaces its output samples. This exists to avoid a
host crash path in After Effects 26 around third-party audio synthesis on text layers; no
carrier layer and no external WAV is created.

## Japanese

Kana *is* the pronunciation, so Japanese needs no dictionary and installs nothing extra.
拗音 (きゃ), 促音 (っ), 撥音 (ん), 長音 (ー) and the small vowels of loanwords (ファ, ヴァ) are all
handled, and katakana shares one table with hiragana. A Japanese mora is timed like a Mandarin
syllable, so Tempo Lock lands Japanese on the beat too.

**Kanji readings are not guessed.** The same character is read differently depending on the
word around it, which needs a dictionary and a disambiguator. Unmarked kanji falls back to its
Mandarin reading, and the panel says on the status line which layers that happened on rather
than letting it sound wrong quietly. Mark it with the same syntax Chinese uses:

```
[今日|きょう]はいい[天気|てんき]
```

は and へ are read *wa* and *e* only as particles, and telling that apart needs the same
analysis: こんにちは is *wa* but おはよう is *ha*, and nothing in the surrounding characters
separates them. Only four fixed greetings with no ambiguity are special-cased; elsewhere, mark
it yourself: `きょう[は|わ]いいてんき`.

## Chinese pronunciation overrides

The pronunciation field accepts:

- Tone-number pinyin: `ni3 hao3 ma5`
- Space-separated Bopomofo: `ㄋㄧˇ ㄏㄠˇ ㄇㄚ˙`
- Inline overrides: `[重|chong2]新開始`

When applying to several text layers at once, each layer uses its own Source Text, so one
override cannot be mistakenly applied to a different sentence.

## English

English is syllabified a **word** at a time rather than a letter at a time, because English
spelling only means anything at word scale — though, through and tough share four letters and
not one sound. The old approach of pairing each consonant with the vowel after it gave
"strength" four syllables.

Handled: vowel digraphs, the silent final e and the length it implies, consonant digraphs that
must not be split (mo-ther, never mot-her), the glide letters that decide whether a syllable
ends or a new one begins (brown is one syllable, flo-wer is two), and word-final l, m and n
that are syllables without a vowel of their own (rhy-thm, lit-tle).

**Stress is the part that matters.** The stressed syllable is longer and higher; the
unstressed ones shorten to roughly half and reduce to a schwa. That alternation is most of
what makes speech sound like English rather than like a list of syllables. Tempo Lock flattens
it, because a beat grid and a stress pattern cannot both be satisfied and the grid is what you
asked for.

This is **not a pronunciation dictionary** and does not pretend to be one. What it gets right
is the syllable count, the vowel colour and the stress, which is what a character voice needs.

## Maintenance and code review

If you are taking over maintenance, or reviewing the project with a tool like Claude Code,
read [`CLAUDE.md`](CLAUDE.md) first. It covers the architecture, the After Effects
compatibility design, the parameter ABI that must not be broken, the order to run the tests
in, and what to review first.

## Licence and trademarks

This project is **source-available**, not open source as the OSI defines it: the source is
public and you may read it, build it and use it yourself (including in paid client work), but
you **may not pass the built files on to anyone else**. See [LICENSE](LICENSE) for the full
terms.

Installers are sold on [Gumroad](https://kadid.gumroad.com/l/IslandChatterAE).

The Unicode reading data keeps its own licence; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

After Effects is a trademark of Adobe; Nintendo and Animal Crossing are trademarks of their
respective owners. This project is not affiliated with or endorsed by any of them.
