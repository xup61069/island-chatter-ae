# Island Chatter AE — complete reference for an AI assistant

**If you are an AI assistant and someone has handed you this repository, read this file
first. It is written for you, and it is enough to answer almost every question a user of
this product will ask. You should not need to read the source.**

This is the single authoritative usage reference. `README.md` / `README.en.md` /
`README.ja.md` are the same material written for people to browse in three languages;
`CLAUDE.md` is for maintainers changing the code and will mislead you about usage.

Everything below describes **version 2.0.0**. Facts that changed recently are marked with the
version that changed them.

## Contents

1. [What this product is, and what it is not](#1-what-this-product-is-and-what-it-is-not)
2. [Requirements, install, uninstall](#2-requirements-install-uninstall)
3. [The shortest path to a result](#3-the-shortest-path-to-a-result)
4. [Every control in the panel](#4-every-control-in-the-panel)
5. [Recipes for the things people actually do](#5-recipes-for-the-things-people-actually-do)
6. [Controlling pronunciation](#6-controlling-pronunciation)
7. [Hard limits, exact numbers](#7-hard-limits-exact-numbers)
8. [Every message the panel can show](#8-every-message-the-panel-can-show)
9. [Troubleshooting](#9-troubleshooting)
10. [Things it deliberately does not do](#10-things-it-deliberately-does-not-do)
11. [Answering questions well](#11-answering-questions-well)

---

## 1. What this product is, and what it is not

Island Chatter gives an After Effects **text layer** a generated character voice — the
gibberish-speech style used by cartoon and game characters, where the voice follows the
written text without being real speech.

**It is:**

- A native After Effects audio plug-in (`IslandChatterNative.aex`) plus a ScriptUI panel
  (`IslandChatterNativePanel.jsx`).
- **Procedural.** Every sample is synthesised from scratch by DSP at render time. There are
  no recordings, no sample library, and no audio files inside the product.
- **Chinese-first.** It carries 44,355 Mandarin character readings and handles tone sandhi.
  It also speaks Japanese kana and English.
- **Deterministic.** The same text and settings always produce exactly the same audio. The
  Seed control is part of that; it does not mean "random each time".
- **Original work.** It contains no Nintendo, *Animal Crossing*, or other game audio, and is
  not affiliated with Adobe or Nintendo.

**It is not:**

- Not a text-to-speech engine. It does not produce intelligible speech, and it is not
  intended to. It produces character *chatter* whose rhythm, pitch contour and mouth shapes
  follow the text.
- Not a voice cloning or sample playback tool.
- Not available on macOS. Windows x64 only, and there is no macOS build planned in the repo.
- Not free software. It is source-available: the code can be read, built and used
  commercially, but redistributing the compiled build is not permitted. Builds are sold at
  `kadid.gumroad.com`.

If a user asks for something in the "is not" list, say so plainly rather than inventing a
workflow.

---

## 2. Requirements, install, uninstall

| | |
| --- | --- |
| OS | Windows 10 or 11, x64 |
| After Effects | 2025 or 2026. Verified on 2026 / Windows 11 |
| macOS | Not supported, no build exists |
| Extra downloads | None. No sample packs, no runtime dependencies |

**Install:** close After Effects completely, then double-click `Install.bat` from the
extracted ZIP and accept the User Account Control prompt. It writes to Program Files and so
needs elevation. Then start After Effects and open the panel from
**Window > IslandChatterNativePanel.jsx**.

**Uninstall:** double-click `Uninstall.bat`.

**What gets installed**, under `…\Adobe After Effects <year>\Support Files\`:

- `Plug-ins\Island Chatter\IslandChatterNative.aex` — the audio effect
- `Plug-ins\Island Chatter\island_chatter_bake.exe` — the engine, also used for timing
- `Scripts\ScriptUI Panels\IslandChatterNativePanel.jsx` — the panel

Common install problems are in [Troubleshooting](#9-troubleshooting).

---

## 3. The shortest path to a result

1. Open a composition.
2. **Window > IslandChatterNativePanel.jsx.**
3. Type something into the big text box at the top — for example `你好，歡迎來到小島！`
4. Press **Apply to selected text layers**.
5. Press <kbd>0</kbd> on the numpad for a RAM preview, or hold <kbd>Ctrl</kbd> and drag the
   time indicator to scrub the audio.

With nothing selected, Apply **creates** a new text layer from what is in the box. With text
layers selected, Apply ignores the box and uses **each layer's own Source Text**.

That distinction is the single most useful thing to know about this product.

---

## 4. Every control in the panel

The panel is one column. The **language dropdown is at the top left** and changes only the
interface — it never changes what is spoken. Kana is always read as Japanese and Han
characters as Mandarin, whatever the panel is showing.

### 4.1 Sliders

Every slider has a number field beside it that accepts typing.

| Control (English) | Range | Default | What it does |
| --- | --- | --- | --- |
| Pitch | 0.10 – 4.00 | 1.00 | Overall pitch multiplier. |
| Speed | 0.10 – 10.00 | 1.00 | How fast syllables come. Driven automatically when Tempo is ticked. |
| Volume | 0.00 – 2.00 | 0.78 | Output gain. **The only voice control that does not force a re-render**, so it is the cheapest one to animate. |
| Consonant | 0.00 – 6.00 | 1.25 | Strength of the consonant attack at the start of each syllable. Shown as *Initial* in the Effect Controls panel. |
| Clarity | 0.00 – 1.00 | 0.78 | How defined the vowels are. Low is mumbling. |
| Cuteness | 0.00 – 1.00 | 0.55 | Shifts the voice younger and brighter. |
| Formant | 0.25 – 4.00 | 1.00 | Vocal-tract size **independent of pitch**. Left is a small animal, right is a giant. This is what makes two characters at the same pitch sound like different creatures. |
| Vibrato | 0.00 – 4.00 | 1.00 | Vibrato depth. |
| Vibrato Rate | 0.00 – 30.00 | 9.20 | Vibrato speed in Hz. |
| Seed | 0 – 999999 | 0 | Fixes the random variation. Same seed plus same settings equals the same audio, always. |
| Leave | 0.1 – 100 | 0.1 | Type-On easing: how motion *leaves* each position. Low leaves at full speed and settles slowly. |
| Smoothness | 0 – 100 | 40 | Type-On: how softly each character crosses the reveal edge. 0 pops, higher fades in. |

Animating Pitch, Speed or Consonant is possible but expensive: After Effects hands the effect
one parameter snapshot per audio block, so every distinct value is a fresh synthesis, and
animating Speed also moves every syllable. **Volume is exempt** and safe to animate.

### 4.2 Menus

- **Voice** — 8 presets: Sunny, Tiny, Cozy, Buzzy, Chirpy, Whisper, Elder, Droid.
- **Emotion** — 7: Neutral, Happy, Angry, Scared, Question, Sleepy, Robot.
- **Character size** — 4: Tiny, Young, Adult, Giant. Default is Adult.
- **Timbre / sound source** — 6: Voice, Reed, Chip, Metallic, Granular, Growl. This replaces
  the sound source itself, not just the resonance.
- **Preset** — Custom, plus the built-ins Mimi, Captain, Grandma, Robot, plus anything saved.
- **Tempo subdivision** — 1 to 4 syllables per beat.
- **Key** — which pitch is *do* when a melody sings its own note names.

### 4.3 Buttons and checkboxes

Grouped by what they are for. Exact strings in all three languages are in
[section 4.4](#44-exact-labels-in-all-three-languages).

**Getting text in and out**

- **Read selected layer** — loads the layer's text and, if Island Chatter is already on it,
  every voice setting, back into the panel.
- **Apply to selected text layers** — the main action. See [section 3](#3-the-shortest-path-to-a-result).
- **Remove** — takes Island Chatter off the selected layers completely: the effect, the Tone
  bootstrap, the rig sliders, the `IC:` markers and the Type-On animator.

**Per-line options** (read when Apply runs)

- **Markers** — one composition marker per syllable, named for the syllable.
- **Fit Duration** — trims the layer to the length of the speech.
- **Rig** — build the animation controllers (see [5.4](#54-animation-controllers-the-rig)).
- **Type-On** — reveal the text one character at a time, in step with the voice.
- **Center** — keep revealed text centred as it types on. For centre-justified text.
- **Chatter** — close the mouth on *every* syllable, the pre-1.10.0 look. Off by default;
  see [5.5](#55-mouth-shapes).

**Characters**

- **Per layer / Shared** — where the rig lives.
- **New** — create a shared character rig.
- **Rebuild** — re-merge a shared rig from its lines. Needed after moving a line in time.
- **Mouth switch** — wire mouth layers or a mouth precomp to a character.
- **Save / Delete / Random** — manage voice presets.

**Scripts and songs**

- **Import script** — one layer per line, laid end to end.
- **Gap** — beats between lines. Accepts decimals.
- **Hold** — keep each line on screen until the next starts.
- **Speakers** — read `Mimi: hello` as a line spoken by Mimi.
- **Choose MIDI / Sing / Speak** — see [5.3](#53-singing-from-a-midi-file).
- **Transpose / Key / Tone** — melody options.

**After an edit**

- **Re-sync** — update the selected lines from their own Source Text, **keeping each line's
  own voice exactly as it is**. This is the button to use after changing text.
- **Re-flow** — lay the selected lines out again end to end.
- **Bake** — render the voice to a WAV beside the project and bring it back as an audio layer.

### 4.4 Exact labels in all three languages

Generated from the panel; if a user reports a label, it is in this table.

<!-- BEGIN COUNTS -->
- Controls and menu entries with a label: **78**
- Distinct messages the panel can print: **65**
- Languages: **3** (繁體中文, English, 日本語), switched by the dropdown at the top left
<!-- END COUNTS -->

<!-- BEGIN LABELS -->
| English | 繁體中文 | 日本語 |
| --- | --- | --- |
| 1 per beat | 每拍 1 字 | 1拍に1音 |
| 2 per beat | 每拍 2 字 | 1拍に2音 |
| 3 per beat | 每拍 3 字 | 1拍に3音 |
| 4 per beat | 每拍 4 字 | 1拍に4音 |
| Adult | 成熟 | おとな |
| Angry | 生氣 | おこり |
| Apply to selected text layers | 套用到選取文字圖層 | 選択したテキストレイヤーに適用 |
| Bake | 轉成音訊 | 音声ファイルに書き出す |
| Buzzy | 電子 | バジー |
| Captain | 隊長 | たいちょう |
| Center | 維持置中 | 中央ぞろえを保つ |
| Chatter | 逐字開合 | 1 音ずつ開閉 |
| Chip | 電子 | チップ |
| Chirpy | 活潑 | チャーピー |
| Choose MIDI | 選 MIDI | MIDI を選ぶ |
| Clarity | 清晰度 | はっきりさ |
| Consonant | 聲母 | しいん |
| Cozy | 溫厚 | コージー |
| Custom | 自訂 | カスタム |
| Cuteness | 可愛度 | かわいさ |
| Delete | 刪除 | 削除 |
| Direct text-layer voice | 文字圖層直接發聲 | テキストレイヤーが直接しゃべる |
| Droid | 機器 | ドロイド |
| Edit text, then apply | 修改文字後按套用 | テキストを直したら適用を押す |
| Elder | 年長 | エルダー |
| Fit Duration | 配合長度 | 長さを合わせる |
| Formant | 共鳴 | きょうめい |
| Gap | 間隔 | あいだ |
| Giant | 巨大 | きょだい |
| Grandma | 奶奶 | おばあちゃん |
| Granular | 破碎 | グラニュラー |
| Growl | 低吼 | うなり |
| Happy | 開心 | うれしい |
| Hold | 接到下一句 | 次までのばす |
| Import script | 匯入劇本 | 台本を読み込む |
| Key | 唱名調 | 階名のド |
| Leave | 離開 | 出るカーブ |
| Markers | 逐字標記 | マーカー |
| Metallic | 金屬 | メタリック |
| Mimi | 咪咪 | ミミ |
| Mouth switch | 建立嘴型切換 | 口パクをつなぐ |
| Neutral | 中性 | ふつう |
| New | 新增角色 | キャラを追加 |
| Per layer | 每層 | レイヤーごと |
| Pitch | 音高 | ピッチ |
| Pronunciation override (optional) | 讀音覆寫（可留空） | 読み方の指定（省略可） |
| Question | 疑問 | ぎもん |
| Random | 隨機 | ランダム |
| Re-flow | 重新排列 | 並べ直す |
| Re-sync | 重新同步 | 文字だけ更新 |
| Read selected layer | 讀取選取圖層 | 選択レイヤーを読み込む |
| Rebuild | 重建 | 作り直す |
| Reed | 簧片 | リード |
| Remove | 移除 | 取り除く |
| Rig | 動畫控制 | リグ |
| Robot | 機器人 | ロボット |
| Save | 儲存角色 | キャラを保存 |
| Scared | 害怕 | こわがり |
| Seed | 種子 | シード |
| Shared | 共用角色 | キャラ共有 |
| Sing | 唱出來 | 歌わせる |
| Sleepy | 疲倦 | ねむい |
| Smoothness | 平滑 | なめらかさ |
| Speak | 改回講話 | しゃべりに戻す |
| Speakers | 含角色名 | 話者名つき |
| Speed | 速度 | はやさ |
| Sunny | 明亮 | サニー |
| Tempo | 節拍 | テンポ |
| Tiny | 迷你 | タイニー |
| Tone | 聲調 | 声調 |
| Transpose | 移調 | 移調 |
| Type-On | 逐字顯示 | 一文字ずつ表示 |
| Vibrato | 顫音 | ビブラート |
| Vibrato Rate | 顫音速率 | ビブラート速度 |
| Voice | 人聲 | ボイス |
| Volume | 音量 | おんりょう |
| Whisper | 耳語 | ウィスパー |
| Young | 少年 | こども |
<!-- END LABELS -->

---

## 5. Recipes for the things people actually do

### 5.1 One talking line

Select a text layer, press **Apply**. Or type in the box with nothing selected and press
Apply to create the layer.

To change the voice afterwards: adjust the panel, select the layer, press **Apply** again.
To change the *text* afterwards: edit the Source Text, select the layer, press **Re-sync**.

**Why Re-sync exists:** Apply writes the panel's current voice onto every selected layer. If
twenty lines belong to three characters and you select them all and press Apply, all twenty
get whichever voice the panel happens to show. Re-sync reads each layer's stored voice back
off the effect and puts it straight back, so it can never repaint anything.

### 5.2 A whole script

Paste the script into the text box, one line per line, and press **Import script**.

- One layer per line, laid end to end from the current time.
- Every line gets the panel's current voice, and its length follows the speech whether or not
  Fit Duration is ticked.
- **Gap** is a *note value*, not a distance: 1 is a quarter note, 0.5 an eighth, 0.25 a
  sixteenth. The next line lands on the first grid step at least that far after the last one
  ended, so it is a minimum. A gap of 0 means no gap and no grid.
- **Hold** keeps each line on screen until the next starts, so a beat of silence is not a beat
  of blank screen. It only ever lengthens a line; the last line keeps its own length.
- **Speakers** reads `咪咪：早安` or `Mimi: Good morning` as a line spoken by that character.
  Full-width and half-width colons both count. **Off by default on purpose**: `注意：這裡很危險`
  ("Warning: it is dangerous here") looks exactly like a speaker name, and guessing would
  invent a character called 注意 and eat the word out of the line.
- A line too long for the transport is **split** at a punctuation mark into as many layers as
  it needs, rather than truncated. (A line you typed and applied by hand *is* truncated, with
  a warning — importing has no typist to tell, so it splits instead.)
- The composition is grown to fit if needed.

### 5.3 Singing from a MIDI file

1. Paste the lyrics into the text box — one line per line, as with a script.
2. Press **Choose MIDI** and pick a `.mid` file. Nothing is created yet; the tracks are
   listed, with the note count beside each. The track with the most notes is preselected.
3. Pick the track that carries the tune.
4. Press **Sing**.

- One layer per lyric line, each placed at **the time of its own first note**. A MIDI import
  ignores the Gap grid, because a song belongs on its own timing.
- One syllable per note, in order. A `-` in the lyric holds the previous syllable across the
  next note.
- A chord keeps only its top note; the panel reports how many notes it dropped.
- **Leave the lyrics empty and it sings the note names** — do re mi — one syllable per note.
  The **Key** dropdown says which pitch is *do*: C is fixed do, G is movable do. It changes
  only the names, never the pitch. A black key takes the name of the white key below it.
- **Transpose** shifts every note by semitones. A character's voice preset does *not*
  transpose the melody, so two characters singing together stay in the same key.
- **Tone** (0–100%, default 15) is how much of the Mandarin tone contour survives. When
  singing, the melody owns the pitch; what is left becomes the *approach* to each note.
- MIDI velocity becomes per-note dynamics. Meter changes (`FF 58`) are read; a file with no
  time signature is treated as 4/4.
- Pressing **Sing** twice asks before duplicating.
- **Speak** takes the melody off the selected lines so they speak again, leaving the voice
  settings alone. Apply deliberately does *not* clear a melody, so this button is the only way.
- **Re-flow skips sung layers** and says how many it skipped, because they belong to the
  MIDI's own timing.

Anything that does not line up is reported in the status line rather than silently absorbed:
syllables with no note, notes with no syllable, chord notes dropped, lines split, text
truncated.

### 5.4 Animation controllers (the rig)

Ticking **Rig** adds controllers that drive character animation from the voice:

| Controller | Value |
| --- | --- |
| `IC Mouth` | 0 closed, 1=a, 2=i, 3=u, 4=e, 5=o |
| `IC Head Bounce` | ±55 |
| `IC Blink` | 0 or 100 |
| `IC Speaking` | 100 while talking, 0 otherwise |
| `IC Line` | which line is currently running |
| `IC Accent` | jumps to 100 at each syllable, settles to 50 over that syllable *(2.0 carries this from 1.11.0)* |

**Per layer** puts five sliders on each line — the original behaviour and still the default.

**Shared** puts one set on a null called `IC Rig <name>`, driven by whichever line is
speaking. This is what lets a whole scene drive one character: bind the mouth once, and every
line drives it regardless of which layer it is on. A line points at its rig with a Layer
Control called `IC Rig Target`, not by name, so renaming a character or reordering layers
cannot break it. The character's voice is stored in the rig null's `comment`, so it travels
with the project to another machine.

**The rig holds keyframes, not expressions.** Nothing evaluates at render time, the project
animates without the plug-in installed, and a rig that has lost a line goes stale rather than
erroring. The cost is that it does not follow a line moved in time — that is what **Rebuild**
is for.

`IC Accent` is the only controller with eased keyframes; the rest are hold keyframes.

### 5.5 Mouth shapes

**Mouth switch** wires selected layers to the chosen character's `IC Mouth`:

- **One mouth precomp selected** → Time Remap. Frame 0 is closed, then a, i, u, e, o.
- **Several layers selected** → Opacity switching, top to bottom: closed, a, i, u, e, o.
  A mouth needs exactly 6 shapes.

**When the mouth closes** *(changed in 1.10.0)*: by default a spoken line closes the mouth
only where there is a real pause — punctuation and the end of the line — and consecutive
syllables just change shape. On ten syllables of dialogue the old rule opened and shut 19
times with the mouth closed 41% of the frames; the new one closes 5 times, 27%.

Tick **Chatter** to get the old per-syllable look back. A sung line ignores the tick either
way: there the short closes are shorter than one frame, which is a sampling artefact rather
than a style, so a sung line closes only where the silence after a note is at least 2 frames.

**Existing keyframes are not rewritten until you press Rebuild (shared) or Apply again
(per layer).**

### 5.6 Type-On

Ticking **Type-On** reveals the text one character at a time, in step with the voice. It
builds a text animator with a range selector called `Island Chatter Reveal`, and produces
ordinary keyframes you can still edit in the graph editor afterwards.

- **Center** keeps the revealed text centred as it types on, gliding into place instead of
  growing out of the left edge. For centre-justified text.
- **Leave** shapes the easing; **Smoothness** softens each character's edge crossing.

### 5.7 Bake to audio

**Bake** writes the voice to a folder called `Island Chatter Audio` beside the project file
and brings it back as an audio layer. No render queue, no dialogs. The project then plays for
someone who does not have the plug-in installed, and playback costs nothing.

- The project must be saved first, because the folder goes beside the `.aep`.
- Baking disables the live effect, so after you edit the text the layer would otherwise play
  what it used to say. Editing marks the bake stale: the recording is **muted**, the effect
  and Tone are re-enabled, and the layer is marked. It is not re-baked automatically.
- **Re-flow moves baked audio with its line.**

### 5.8 How a layer is put together

Useful when a user describes what they see in the timeline:

- The layer's **Source Text** is authoritative. The panel copies up to 128 UTF-16 units of it
  into hidden effect parameters.
- A zero-level built-in **Tone** effect named `Island Chatter Audio Bootstrap` sits
  immediately before the Island Chatter effect. It is an intentional bootstrap that creates
  the host sound object; **it must stay at level 0 and must not be removed**, or the layer
  goes silent. It is not a bug and not a leftover.
- The Island Chatter effect is displayed as **Island Chatter Voice**.
- Markers are named `IC: <syllable>`.

---

## 6. Controlling pronunciation

### 6.1 Mandarin

Han characters are read as Mandarin, with tone sandhi applied. Where a character is
ambiguous, override it:

| Form | Example | Notes |
| --- | --- | --- |
| Inline override | `[重|chong2]新開始` | Overrides one character in place |
| Tone-number Pinyin | `ni3 hao3` | Digit 1–5 after each syllable |
| Zhuyin / Bopomofo | `ㄋㄧˇ ㄏㄠˇ` | |

The **Pronunciation override** field takes the same forms and applies to the whole line.

### 6.2 Japanese

Kana is spoken directly — 拗音, 促音, 撥音, 長音 and the small vowels of loanwords. A syllabary
needs no dictionary, so Japanese costs nothing to install. Katakana shares hiragana's table.
One Japanese mora is treated as one Mandarin syllable in length, so tempo lock works.

**Unmarked kanji keeps its Mandarin reading and the panel warns you.** The reading of a kanji
depends on the word, and guessing needs a dictionary the product deliberately does not carry.
Mark the reading yourself, or write the word in kana.

The particles は and へ are a known ambiguity: こんにちは is *wa*, おはよう is *ha*, and no
local rule separates them. A small table of fixed greetings handles the unambiguous ones.

### 6.3 English

English is syllabified **a word at a time**, with stress: stressed syllables are long,
unstressed ones shorten to roughly half and reduce to a schwa. That alternation is most of
what makes it sound like English.

It is a small rule set, not a pronunciation dictionary — it aims to get the syllable count,
the vowel colour and the stress right, not the exact phonemes. Tempo lock flattens the stress
pattern, because a beat grid and a stress pattern cannot both be satisfied.

---

## 7. Hard limits, exact numbers

| Limit | Value | What happens at the limit |
| --- | --- | --- |
| Text per layer | **128 UTF-16 units** | A typed line is truncated **and reported**. An imported line is **split** at punctuation into more layers. A surrogate pair counts as 2 units and is never cut in half. |
| Notes per layer | **64** | A longer melody is split, and the cut backs up to the last **bar line** so it reads as a line rather than a mistake. |
| Effect parameters | **279** | A saved-project contract. Do not expect this to change. |
| Melody timing resolution | **1/96 of a beat** | Supports 64th notes (6 ticks) and 32nd triplets (8). ~5.2 ms at 120 BPM. |
| Mouth shapes | **6** | closed, a, i, u, e, o |
| Sung mouth-close threshold | **2 frames** | Frames, not seconds, so it behaves the same at any frame rate |
| Mandarin readings | **44,355** characters | |
| Bake folder | `Island Chatter Audio` | Beside the `.aep` |

**Backwards compatibility:** a project saved by any earlier 1.x version opens and sounds
identical. Every appended parameter has a default that reproduces the previous behaviour, and
a melody length of zero is what keeps a pre-1.7.0 project speaking. 2.0.0 changed **no audio
at all** — it is an interface release.

---

## 8. Every message the panel can show

If a user quotes something the panel said, find it here. Generated from the panel, so it is
complete and current. `{0}` and `{1}` are filled in with counts or names at runtime.

<!-- BEGIN MESSAGES -->
| English | 繁體中文 | 日本語 |
| --- | --- | --- |
|    OUT OF RANGE | 　　超出範圍 | 　　範囲外 |
|   (x{0} character) | 　（x{0} 角色補償） | 　（x{0} キャラ補正） |
|   ({0} sung layer(s) left in place) | 　（唱歌 {0} 層維持原位） | 　（歌の {0} レイヤーはそのまま） |
|   +{0} split | 　+{0} 斷句 | 　+{0} 行に分割 |
|   cast: {0} | 　角色：{0} | 　キャラ：{0} |
|   comp grown to {0}s | 　合成延長到 {0}s | 　コンポを {0}s に延長 |
|   eighth | 　八分 | 　8 分 |
|   half | 　二分 | 　2 分 |
|   held x{0} | 　接到下一句 x{0} | 　次までのばす x{0} |
|   quarter | 　四分 | 　4 分 |
|   rig x{0} | 　控制器 x{0} | 　リグ x{0} |
|   sixteenth | 　十六分 | 　16 分 |
|   stale bake x{0} | 　轉檔過期 x{0} | 　書き出し古い x{0} |
| = 0s  no grid | = 0s　無格線 | = 0s　グリッドなし |
| Applied to {0} layer(s) | 已套用 {0} 個圖層 | {0} レイヤーに適用しました |
| Apply Island Chatter first, then bake. | 請先按 Apply 再轉成音訊。 | 先に適用してから書き出してください。 |
| Apply Island Chatter to these layers first. | 這些圖層還沒套用過。 | これらのレイヤーにはまだ適用されていません。 |
| Baked {0} layer(s) -> {1} | 已轉成音訊 {0} 層 -> {1} | {0} レイヤーを書き出しました -> {1} |
| Character {0} | 角色 {0} | キャラ {0} |
| Choose a MIDI file | 選一個 MIDI 檔 | MIDI ファイルを選ぶ |
| Choose a MIDI file first. | 請先按「選 MIDI」挑一個檔案。 | 先に「MIDI を選ぶ」でファイルを選んでください。 |
| Choose a track first. | 請先選一個軌道。 | 先にトラックを選んでください。 |
| Choose or create a character first. | 請先選擇或新增角色。 | 先にキャラを選ぶか追加してください。 |
| Error | 錯誤 | エラー |
| Imported {0} layer(s) | 已匯入 {0} 層 | {0} レイヤーを読み込みました |
| Kanji read as Chinese: {0} | 漢字以中文讀音唸出：{0} | 漢字は中国語読みです：{0} |
| MIDI loaded: {0} — pick a track, then Sing | 已讀取 {0} —— 選好軌道後按「唱出來」 | MIDI を読み込みました：{0} —— トラックを選んで「歌わせる」 |
| Mouth on Time Remap | 嘴型已接上時間重映射 | 口パクをタイムリマップにつなぎました |
| Mouth switch on {0} layer(s) -> {1} | 已接上嘴型 {0} 層 -> {1} | 口パクを {0} レイヤーにつなぎました -> {1} |
| Name this character | 幫這個角色取個名字 | キャラの名前を入れてください |
| No notes in that file | 這個檔案裡沒有音符 | このファイルに音符がありません |
| None of those were singing | 選取的圖層沒有旋律 | 選んだレイヤーにメロディがありません |
| Now editing {0} | 目前角色：{0} | 編集中のキャラ：{0} |
| Only the first {0} UTF-16 units are spoken; the rest of the Source Text was cut: ⏎  ⏎ {1} | 只會唸出前 {0} 個 UTF-16 字元，超出的 Source Text 已截斷： ⏎  ⏎ {1} | しゃべるのは最初の {0} UTF-16 単位までです。残りのソーステキストは切りました： ⏎  ⏎ {1} |
| Open an active composition first. | 請先開啟合成。 | 先にコンポジションを開いてください。 |
| Overlapping lines: {0} | 台詞重疊：{0} | セリフが重なっています：{0} |
| Paste a script into the text box first. | 請先把劇本貼進上面的文字框。 | 先に台本をテキスト欄に貼り付けてください。 |
| Re-flowed {0} layer(s) @ {1} beat(s) | 已排列 {0} 層 @ {1} 拍 | {0} レイヤーを {1} 拍あけて並べ直しました |
| Re-synced {0} layer(s) | 已重新同步 {0} 層 | {0} レイヤーを更新しました |
| Read settings from {0} | 已讀取設定：{0} | {0} から設定を読み込みました |
| Read text only | 只讀到文字（此圖層尚未套用） | テキストだけ読み込みました（未適用） |
| Rebuilt {0} rig(s), {1} line(s) | 已重建 {0} 組控制器、{1} 句 | リグ {0} 組・{1} 行を作り直しました |
| Removed {0} item(s) from {1} layer(s) | 已移除 {1} 層上的 {0} 個項目 | {1} レイヤーから {0} 項目を取り除きました |
| Saved {0} | 已儲存：{0} | {0} を保存しました |
| Select a saved character first. | 請先選取自訂角色。 | 先に保存したキャラを選んでください。 |
| Select a text layer or enter text first. | 請選取文字圖層或先輸入文字。 | テキストレイヤーを選ぶか、文字を入力してください。 |
| Select a text layer. | 請選取文字圖層。 | テキストレイヤーを選んでください。 |
| Select the lines to turn back into speech. | 請選取要改回講話的圖層。 | しゃべりに戻すレイヤーを選んでください。 |
| Speaking again: {0} layer(s) | 已改回講話 {0} 層 | {0} レイヤーをしゃべりに戻しました |
| Speed set manually | 語速為手動設定 | はやさは手動設定です |
| Sung note names on {0} layer(s) | 已唱唱名 {0} 層 | 階名で {0} レイヤーを歌わせました |
| Sung {0} layer(s) | 已唱出 {0} 層 | {0} レイヤーを歌わせました |
| Sung {0} line(s) — {1} | 已唱出 {0} 句 —— {1} | {0} 行を歌わせました —— {1} |
| There are already {0} layer(s) here from an earlier MIDI import. ⏎  ⏎ Remove them first? No adds a second copy. | 這個合成裡已經有 {0} 層是之前匯入的。 ⏎  ⏎ 要先移除它們嗎？按「否」就直接再加一份。 | このコンポには前回の MIDI 読み込みで作られたレイヤーが {0} 枚あります。 ⏎  ⏎ 先に取り除きますか？「いいえ」でもう一組追加します。 |
| There are no Island Chatter lines here. | 這個合成裡沒有台詞圖層。 | このコンポにセリフのレイヤーがありません。 |
| There is no shared rig here. | 這個合成裡沒有共用控制器。 | このコンポには共有リグがありません。 |
| Truncated: {0} | 已截斷：{0} | 文字が切れました：{0} |
| truncated: {0} | 被截斷：{0} | 切れました：{0} |
| {0} line(s) · {1} BPM | {0} 句・{1} BPM | {0} 行・{1} BPM |
| {0} long line(s) split | 太長的句子拆成 {0} 層 | 長い行を {0} レイヤーに分けました |
| {0} note(s) dropped from chords | 和弦捨去 {0} 個音 | 和音から {0} 音を省きました |
| {0} note(s) with no syllable | {0} 個音符沒有字 | {0} 音に歌詞がありません |
| {0} s/syllable   Speed {1} | {0} 秒／字   Speed {1} | {0} 秒／音   Speed {1} |
| {0} syllable(s) with no note | {0} 個字沒有音符（用最後一個音唱完） | {0} 文字に音符がありません（最後の音でのばします） |
| {0} track(s) · {1} BPM | {0} 軌・{1} BPM | {0} トラック・{1} BPM |
<!-- END MESSAGES -->

---

## 9. Troubleshooting

**"Native effect is not installed" / 找不到已安裝的效果**
Usually it *is* installed. The panel wraps whatever After Effects threw, so a registration
problem inside the plug-in surfaces as a message about installation. Read the raw error in
the alert. Check that After Effects was fully closed during install, that the version is 2025
or 2026, and that `IslandChatterNative.aex` is in
`Support Files\Plug-ins\Island Chatter\`.

**No sound at all**
Check the Tone effect named `Island Chatter Audio Bootstrap` is still on the layer,
immediately before the Island Chatter effect, at level 0. Removing it silences the layer.
Also check the layer's audio is enabled and Volume is not 0.

**The audio is stale — it plays what the text used to say**
The layer has been baked. Baking disables the live effect. Un-mute or delete the baked
recording and press Apply, or re-bake.

**Text is cut off**
The layer is over the 128-unit limit. Split the line yourself, or use **Import script**,
which splits automatically at punctuation.

**Japanese kanji is read in Chinese**
Expected. Mark the reading or write the word in kana. See [6.2](#62-japanese).

**Editing the text changed all my voices**
Apply was pressed with several layers selected; it writes the panel's voice onto all of them.
Undo, then use **Re-sync** instead, which never touches the sound.

**The mouth animation did not update after I changed a setting**
The rig holds keyframes, so nothing rewrites itself. Press **Rebuild** for a shared rig, or
Apply / Re-sync again for a per-layer rig.

**The mouth stopped part-way through a line, or two characters overlap**
Two lines of one character are speaking at once. The panel reports this as
"Overlapping lines". The later line wins from where it starts.

**Labels look cut off after switching language** *(fixed in 2.0.0)*
Versions before 2.0.0 measured each control once and did not re-measure after a language
change, so longer labels were drawn into the old box and clipped with an ellipsis. Update, or
reopen the panel — building it fresh always measured correctly.

**I switched to Japanese and cannot find the control to switch back** *(fixed in 2.0.0)*
The language dropdown used to be right-aligned and could leave the panel in a narrow dock. It
is now at the **top left**. On an older version, widen the panel or delete the stored
preference.

**Bake fails**
Save the project first — the audio folder goes beside the `.aep`. If it still fails, the
previous bake of that layer is probably still imported; the panel handles this itself, but a
locked file or a read-only folder will stop it.

**Re-flow moved my song**
It should not — sung layers are skipped. If a sung line moved, it had no melody on it.

---

## 10. Things it deliberately does not do

Explaining *why* is usually more useful than saying no. These are decisions, not gaps:

- **No macOS build.** Windows x64 only.
- **No kanji dictionary.** The reading depends on the word; guessing needs a corpus the
  product does not ship. Unmarked kanji keeps its Mandarin reading and warns.
- **No automatic speaker-name detection.** `注意：這裡很危險` is indistinguishable from a
  speaker name, so it is behind a checkbox rather than a heuristic.
- **No language override parameter.** Kana and Han characters identify themselves.
- **No background polling for text changes.** After Effects refuses scheduled scripts around
  modal dialogs, so the user presses Apply or Re-sync deliberately.
- **No staleness warning when you edit text.** The natural response — select everything and
  press Apply — would repaint every voice, so the fix was Re-sync rather than a warning.
- **No custom recorded timbre.** Deferred by the author. Sample playback was rejected because
  it bypasses the engine and loses Mandarin tones.
- **No in-panel audition.** Preview in the composition.
- **Sung pitch is absolute** and not scaled by the voice preset, so two characters singing
  together stay in the same key.

---

## 11. Answering questions well

Some guidance specific to this product:

- **Ask which language the panel is in, or give all three labels.** Users run this in
  Traditional Chinese, English or Japanese. The tables in
  [4.4](#44-exact-labels-in-all-three-languages) and [8](#8-every-message-the-panel-can-show)
  let you name a control in whichever one they are using.
- **Apply versus Re-sync is the most common confusion.** If someone says editing text broke
  their voices, that is almost always it.
- **Do not invent parameter names.** The effect's parameters in the Effect Controls panel are
  labelled bilingually, e.g. `Pitch / 音高`, `Initial / 聲母`, `Timbre / 音源`. Note that
  *Consonant* in the panel is *Initial* in the Effect Controls.
- **Do not suggest editing the hidden parameters.** Text and melody are carried in invisible
  sliders; they are a transport, not a user interface.
- **Do not suggest removing the Tone effect.** It looks redundant and is not.
- **Version matters.** The mouth default changed in 1.10.0, `IC Accent` arrived in 1.11.0, and
  2.0.0 is interface-only. `CHANGELOG.md` has the full history in Traditional Chinese.
- **If a question is about changing the code**, that is `CLAUDE.md` and the source, not this
  file. This file describes the product as shipped.

### Where to look in the repository

| Path | What is there |
| --- | --- |
| `AI-GUIDE.md` | This file. Usage, complete. |
| `README.md` / `.en.md` / `.ja.md` | The same material for people, in three languages |
| `CHANGELOG.md` | Full version history, Traditional Chinese, written for users |
| `CLAUDE.md` | Maintainer guide and design invariants. Not a usage reference |
| `native/panel/IslandChatterNativePanel.jsx` | The panel — every label and message |
| `native/src/dsp.cpp` | The synthesis engine, Mandarin readings, kana, English syllables |
| `native/plugin/params.hpp` | The 279-parameter layout |
| `docs/gumroad-listing.md` | Storefront copy in three languages |
| `LICENSE` | Source-available terms |

---

*Generated tables in this file are produced by `node tools/build-ai-guide.js` and checked by
`npm test`, so the strings above always match the shipped panel.*
