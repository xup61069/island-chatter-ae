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
- Import a MIDI file and the character sings: one layer per lyric line, one note per syllable,
  placed at the times the file says
- With no lyric at all, the melody sings its own note names — fixed or movable do
- Sung notes are held rather than clipped, tones give way to the melody, vibrato grows in on a
  long note, and pitches glide into each other; a `-` in the lyric holds a syllable over
- Paste a whole script and get one layer per line, laid out in sequence, over-long lines split
- Speaker names in the script assign each line to its character in one pass
- Gaps are counted in beats, and every line lands on the beat
- Re-sync edits text without touching the voice; Re-flow puts the scene back in order
- The panel remembers its settings between sessions
- Optional Fit Duration and `IC:` per-syllable timing markers
- Optional `IC Mouth`, `IC Volume`, `IC Pitch`, `IC Head Bounce`, `IC Blink` animation controllers
- One rig shared by a whole character, driven by whichever line is speaking, so twenty lines are bound once
- One click wires mouth layers or a mouth precomp to that rig
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

## The edit cycle

**Re-sync** updates the selected lines from their own Source Text and **does not touch the
voice**. This is the button for changing text. Apply writes the panel's current settings over
every selected layer, so a selection spanning two characters is silently repainted into one
voice — and a wrong voice makes no wrong-sounding noise, it just becomes somebody else.

Only what a layer already carries is rebuilt: a line with no markers does not gain any. The
length is always refitted, and the composition grows if a longer line no longer fits.

**Re-flow** lays the selected lines out again end to end using each one's real length; with
nothing selected, the whole composition. Press it after editing or deleting a line and
everything after it makes room or closes up. The first line stays where it is apart from being
pulled onto the beat, baked audio moves with its line, and running it twice changes nothing.

## Singing: importing MIDI

Paste the lyrics into the text box (**one line per phrase**), press **Choose MIDI** and pick a
`.mid` file, choose a track from the dropdown beside it, then press **Sing**.

It is two steps because a MIDI file usually has several tracks and guessing wrong means singing
the accompaniment. The track with the most notes is selected for you, which is nearly always the
tune.

- **One note per syllable**, in order. Punctuation does not take a note.
- **Each line goes where its own first note is.** Importing MIDI ignores the beat grid the Gap
  field sets up — a song belongs at its own times, not at yours. The length always follows the
  melody.
- **A `-` in the lyric** holds the previous syllable through the next note, so `ah--` is one
  syllable over three notes. The rule only applies when there is a melody, so a hyphen in
  ordinary dialogue behaves exactly as it always did.
- **Chords are reduced to their top note**, and it says how many were discarded.
- **A lyric that does not fit its melody is reported**: spare syllables finish on the last
  pitch, spare notes are left unsung, and both appear in the status line.
- **A line too long for one layer is split rather than cut.** A layer carries at most 64 melody
  slots (rests take one too) and 128 characters; the rest continues on the next layer, and the
  split **prefers a bar line**. It never falls inside a `[重|chong2]` override or through a
  character. The status line says how many layers a line became.

### With no lyric, it sings the note names

**Leave the text box empty** and press Sing: the melody sings its own names —
`do do sol sol la la sol`. One syllable per note, broken into layers wherever there is a rest
of two beats or more.

**Key** decides which pitch is do:

- Leave it on **C** for fixed do, where C is do. This is the one to leave alone.
- Pick **G** for movable do: G becomes do and the whole set shifts, so the same tune reads
  `fa fa do do…` instead of `do do sol sol…`.

**Only the names move; the pitch never does** — every note still sounds exactly as written. An
accidental takes the name of the natural below it, because the seventh is "si" in Chinese
practice and a chromatic set needs that syllable for something else.

The names become the layer's real text, so you can edit them, and markers and mouth shapes
follow as usual.

### Transpose and Tone

| Field | Meaning |
| --- | --- |
| **Transpose** | Semitones added to every note. `-12` is an octave down, `12` an octave up. |
| **Tone** | How much of the Mandarin tone contour survives, as a percentage. Default 15; no effect on note names. |

**A sung note is at its written pitch, and the voice preset's register is deliberately not
applied.** The presets run from 0.66 to 1.42, so letting one in would transpose the melody by up
to a fifth and stop two characters from ever singing together. What makes a character sound like
itself is the vocal tract and the timbre — which is also how it works in people.

**Tones give way to the melody without disappearing.** Pitch is the melody's job, and a full
four-tone contour fights it. What survives becomes the *approach* to each note: a falling tone
drops into it from above, a rising tone comes up from below. The diction still reads as Chinese
and the pitch is still the tune. 0 removes it entirely; 100 keeps all of it, which goes out of
tune but is occasionally the effect you want.

> Singing uses the same Vibrato sliders as speech. Turn **Vibrato** up for a more obvious one.

## Importing a script

Paste a script into the text box and press **Import script**: **one layer per line**, each
applied with the current voice and laid end to end from the current time. Blank lines are
skipped.

### The gap is in beats, and every line lands on one

**Gap** is a number of beats against the BPM above, and **fractions are note values**:

| Value | Meaning | Snaps to |
| --- | --- | --- |
| `2` | minim | beats |
| `1` | crotchet | beats |
| `0.5` | quaver | quavers |
| `0.25` | semiquaver | semiquavers |
| `0` | no gap | nothing; lines run straight on |

**The grid is as fine as the number asks for**, so 0.5 lands lines on quavers. A gap of a beat
or more still uses ordinary beats, because "leave two beats" means any beat two beats away
rather than only every second one.

The next line starts on the first grid line that is at least that far after the previous one
ends — so it is a **minimum, not a fixed distance**. Converting beats to seconds would not be
enough: without Tempo Lock a line is not a whole number of beats long, so a fixed distance puts
the third line off the grid and every line after it drifts further. The first line is pulled
onto the grid too.

> If the silence looks longer than you asked for, check the punctuation. A full stop makes the
> engine rest, that rest is part of the line's own length, and the gap is added after it.

### Speaker names

Tick **Speakers** and write the script like this:

```
Mimi: Good morning.
Captain: Morning to you too.
Mimi: Lovely weather today.
```

The name is not spoken, and each line joins that character's shared rig, which is created if
it does not exist yet. A two-hander goes in as one paste.

> It is off by default on purpose: `Note: this is dangerous` looks exactly like a speaker name,
> and guessing would invent a character called Note and eat the word out of the line. This is
> your call to make, not the program's.

Every line is fitted to its own length **whether or not Fit Duration is ticked** — laying
lines end to end means knowing where each one ends, and only the engine's plan knows that.

**A line too long for the transport becomes several layers** rather than being cut off. The
break goes to the last punctuation before the limit, where the voice was going to rest
anyway, and never through a pronunciation override like `[重|chong2]` or a surrogate pair.

> Pressing Apply on a layer *you* typed still truncates at 128 units and says so. Rewriting
> text someone typed is a different matter from laying out text they pasted.

The composition is **extended if the script does not fit**, and only as far as the script
needs. Without that, a line placed past the end has its length clamped to nothing and half
the scene disappears silently.

Importing into a shared character rig works too: pick the character first and every line
joins it, with the rig merged once at the end.

## The panel remembers

Every voice control, the tempo, all four workflow checkboxes, where the rig goes, the Type-On
curves and the import gap survive a restart — the panel opens where you left it. Only the
interface language and saved characters used to, so a project spread over several days meant
setting it all up again every morning.

## The animation rig

With **Rig** ticked, choose where the controllers go:

- **Per layer** — five sliders on each line, as every version before 1.4.0 did. Existing
  projects stay here.
- **Shared** — one set of sliders for a whole character, on a null named `IC Rig <name>`,
  driven by whichever line is speaking at that moment. Twenty lines, one thing to bind.

Press **New** and name the character; from then on, every Apply with that character selected
adds the line to it. The character's voice is stored on the null itself, so it travels with
the project rather than living in one machine's preferences — open it anywhere, pick the
character, and the settings come back.

A shared rig holds **keyframes, not expressions**. Playback costs nothing, the project
animates on a machine with no plug-in installed, and a rig that has lost a line goes stale
rather than turning into a yellow error. The price is that moving a line in time does not
move the rig with it: press **Rebuild** and it re-merges from wherever the lines are now,
without touching the voice.

A shared rig carries two tracks a single line cannot answer: `IC Speaking` is 100 while
anyone is talking and 0 between lines, and `IC Line` says which line that is. Idle animation
and per-line switching both need them.

Two lines of one character at once still build. The later one wins from the moment it starts,
the earlier one is cut there rather than closing the mouth halfway through the later one, and
the status line names both.

### Mouth switch

`IC Mouth` is **0 for closed and 1-5 for a, i, u, e, o**. With a character selected, press
**Mouth switch**:

- **One mouth precomp selected** → driven by Time Remap: frame 0 closed, then a, i, u, e, o.
- **Up to six layers selected** → switched by Opacity, **topmost first**: closed, a, i, u, e, o.

The expression finds the rig through a Layer Control, so renaming the character or reordering
the composition cannot break it, and a missing rig falls back to a closed mouth instead of
six error banners.

The rest: `IC Head Bounce` is ±55 and `IC Blink` is 0/100 — pick-whip them and scale to taste.

**Remove** on a line takes it out of the rig and rebuilds without it; Remove on the rig layer
deletes it and unbinds every line and every mouth layer that pointed at it.

## Bake to audio

Press **Bake** and the voice is written to a WAV in an `Island Chatter Audio` folder beside
the project file, imported automatically as an audio layer under the original, with the live
effect muted so nothing is heard twice.

After baking, playback costs nothing to compute, the waveform is visible on the timeline, and
anyone without the plug-in can still hear the project. This does not go through the After
Effects render queue and touches neither the work area nor any other layer; it usually takes a
few hundred milliseconds. The project has to be saved first so the audio knows where to live.

**What if the text changes after baking?** Baking mutes the live effect, so the layer would go
on playing what it used to say. Apply and Re-sync now mute the stale recording, switch the live
effect back on and mark the layer `(stale)` — what you hear is always what the layer says, and
whether to bake again is your call.

It is deliberately not re-baked for you: After Effects only releases an imported WAV on
`app.purge()`, so an automatic re-bake would throw away the undo history every time you press
Apply.

The audio layer is found through a Layer Control rather than by name, so renaming a line no
longer orphans it. Re-flow moves it with its line, and Remove takes it away too. The WAV on
disk is left alone.

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
