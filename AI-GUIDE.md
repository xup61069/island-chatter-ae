# Island Chatter AE — complete reference for an AI assistant

**If you are an AI assistant and someone has handed you this repository, read this file
first. It is written for you, and it is enough to answer almost every question a user of
this product will ask. You should not need to read the source.**

This is the single authoritative usage reference. `README.md` / `README.en.md` /
`README.ja.md` are the same material written for people to browse; the panel itself also speaks 简体中文;
`CLAUDE.md` is for maintainers changing the code and will mislead you about usage.

Everything below describes **version 3.7.0**. Facts that changed recently are marked with the
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
- **Procedural.** Every sample of the built-in voice is synthesised from scratch by DSP at
  render time. There are no recordings, no sample library, and no audio files inside the
  product.
- **Local, except for one optional button.** The built-in voice never touches a network and
  needs no account. *(2.4.0)* **Cloud voice** is the exception and is opt-in in every sense:
  the user supplies their own API key, presses the button, and confirms a dialog stating how
  many characters are about to be sent and to whom. Nothing is sent otherwise. If a user asks
  whether their scripts leave the machine, the honest answer is: not unless they press that
  button, and it says so before it does.
- **Chinese-first.** It carries 44,355 Mandarin character readings and handles tone sandhi.
  It also speaks Japanese kana and English.
- **Deterministic.** The same text and settings always produce exactly the same audio. The
  Seed control is part of that; it does not mean "random each time".
- **Original work.** It contains no Nintendo, *Animal Crossing*, or other game audio, and is
  not affiliated with Adobe or Nintendo.

**It is not:**

- Not a text-to-speech engine. The built-in voice does not produce intelligible speech and is
  not intended to; it produces character *chatter* whose rhythm, pitch contour and mouth
  shapes follow the text. *(2.4.0)* **Cloud voice** does give real speech, but it is somebody
  else's model doing it, on the user's own account — this product carries no speech model and
  no credit of any kind.
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
| Network | Not needed. *(2.4.0)* Only the optional Cloud voice button uses one, and only when pressed |
| Cloud voice accounts | *(2.4.0)* Optional. The user's own OpenAI, ElevenLabs or Azure Speech API key. No credit is included |

**Install:** close After Effects completely, then double-click `Install.bat` from the
extracted ZIP and accept the User Account Control prompt. It writes to Program Files and so
needs elevation. Then start After Effects and open the panel from
**Window > IslandChatterNativePanel.jsx**.

**Uninstall:** double-click `Uninstall.bat`.

**What gets installed**, under `…\Adobe After Effects <year>\Support Files\`:

- `Plug-ins\Island Chatter\IslandChatterNative.aex` — the audio effect
- `Plug-ins\Island Chatter\island_chatter_bake.exe` — the engine, also used for timing
- `Plug-ins\Island Chatter\island_chatter_voice.exe` — *(2.4.0)* the cloud voice. It is the
  only part of the product that opens a network connection, and it only runs when the Cloud
  voice button is pressed. It exists as a separate executable because ExtendScript has no TLS
  and cannot make an HTTPS request at all
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

The **language dropdown is at the top left** and changes only the interface — it never
changes what is spoken. Kana is always read as Japanese and Han characters as Mandarin,
whatever the panel is showing.

**The settings are on three tabs** *(2.4.0; four in 2.2.0–2.3.0, and one long column before that)*:

| Tab | What is on it |
| --- | --- |
| **Speak** | The text box, Read selected layer, the pronunciation override, the voice / emotion / character-size menus, Pitch, Speed, Volume, Consonant, Clarity, Cuteness, Tempo — and *(2.4.0)* Import script, Gap, Hold, Speakers, which moved here because importing a script is typing with more lines in it |
| **Timbre & animation** | *(2.4.0, was two tabs)* Formant, sound source, Vibrato, Vibrato Rate, Seed, *(3.1.0)* Preview, the saved-character menu with Random / Save / Delete; then Markers, Fit Duration, Rig, Type-On, Chatter, Center, per-layer or shared rig, the character menu with New / Rebuild, Mouth switch, Leave, Smoothness. Both halves are about the *character* rather than about the line |
| **Sing & dub** | The three ways a performance arrives already made: Choose MIDI, the track menu, Transpose, Key, Tone, Sing, Speak; *(2.3.0)* Lip-sync from audio, Vowels, Sensitivity; *(2.4.0)* Cloud voice, the voice-source menu, API key, Voice ID, Model, Region; *(3.1.0)* Get model, which fetches the offline model — 177 MB, once, and the voice then runs on this machine with no network, no account and no key. It is Mandarin as spoken in China, by a woman; that is the only Chinese model with a licence that allows it, and no Taiwanese-accented offline model exists |

If a user is on an older build the tabs are different — **Timbre** and **Animation** were
separate through 2.3.0, and **Import** held the script importer. Ask which version they have
before telling them where a control is.

**Apply, Re-sync, Re-flow, Bake, Remove and the status line are not on a tab.** They sit
below the tabs and are visible whichever one is showing, so telling a user to "press Apply"
never needs them to switch pages first. The panel remembers which tab was last open.

If a user says they cannot find a control, ask which tab they are on before anything else.

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

Grouped by what they are for. Exact strings in all four languages are in
[section 4.4](#44-exact-labels-in-all-three-languages).

**Getting text in and out**

- **Read selected layer** — loads the layer's text and, if Island Chatter is already on it,
  every voice setting, back into the panel.
- **Apply to selected text layers** — the main action. See [section 3](#3-the-shortest-path-to-a-result).
- **Remove** — takes Island Chatter off the selected layers completely: the effect, the Tone
  bootstrap, the rig sliders, the `IC:` markers and the Type-On animator. *(3.1.0)* It also puts
  the layer's length back to what it was before Fit Duration changed it. A layer that was never
  fitted is left alone.
- *(3.1.0)* **Preview** (on the Timbre & animation page) — speaks the selected layer's text, or
  the text box, in the voice the panel is currently set to, without touching the project: no
  layer, no effect, no undo step, no file beside the .aep. After Effects stops responding while
  it plays, because it waits for the sound to finish.

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

### 4.4 Exact labels in all four languages

Generated from the panel; if a user reports a label, it is in this table.

<!-- BEGIN COUNTS -->
- Controls and menu entries with a label: **87**
- Distinct messages the panel can print: **108**
- Languages: **4** (繁體中文, 简体中文, English, 日本語), switched by the dropdown at the top left
<!-- END COUNTS -->

<!-- BEGIN LABELS -->
| English | 繁體中文 | 简体中文 | 日本語 |
| --- | --- | --- | --- |
| 1 per beat | 每拍 1 字 | 每拍 1 字 | 1拍に1音 |
| 2 per beat | 每拍 2 字 | 每拍 2 字 | 1拍に2音 |
| 3 per beat | 每拍 3 字 | 每拍 3 字 | 1拍に3音 |
| 4 per beat | 每拍 4 字 | 每拍 4 字 | 1拍に4音 |
| API key | 金鑰 | 金钥 | APIキー |
| Adult | 成熟 | 成熟 | おとな |
| Angry | 生氣 | 生气 | おこり |
| Apply to selected text layers | 套用到選取文字圖層 | 应用到选中文本图层 | 選択したテキストレイヤーに適用 |
| Bake | 轉成音訊 | 转成音频 | 音声ファイルに書き出す |
| Built-in | 內建 | 内建 | 内蔵 |
| Buzzy | 電子 | 电子 | バジー |
| Center | 維持置中 | 维持置中 | 中央ぞろえを保つ |
| Chatter | 逐字開合 | 逐字开合 | 1 音ずつ開閉 |
| Chip | 電子 | 电子 | チップ |
| Chirpy | 活潑 | 活泼 | チャーピー |
| Choose MIDI | 選 MIDI | 选 MIDI | MIDI を選ぶ |
| Clarity | 清晰度 | 清晰度 | はっきりさ |
| Clear | 清除 | 清除 | 消去 |
| Cloud voice | 雲端語音 | 云端语音 | クラウド音声 |
| Consonant | 聲母 | 声母 | しいん |
| Cozy | 溫厚 | 温厚 | コージー |
| Cuteness | 可愛度 | 可爱度 | かわいさ |
| Delete | 刪除 | 删除 | 削除 |
| Direct text-layer voice | 文字圖層直接發聲 | 文本图层直接发声 | テキストレイヤーが直接しゃべる |
| Droid | 機器 | 机器 | ドロイド |
| Ease | 緩動 | 缓动 | 動きのため |
| Edit text, then apply | 修改文字後按套用 | 修改文字后按应用 | テキストを直したら適用を押す |
| Elder | 年長 | 年长 | エルダー |
| Fit Duration | 配合長度 | 配合长度 | 長さを合わせる |
| Formant | 共鳴 | 共鸣 | きょうめい |
| Gap | 間隔 | 间隔 | あいだ |
| Giant | 巨大 | 巨大 | きょだい |
| Granular | 破碎 | 破碎 | グラニュラー |
| Growl | 低吼 | 低吼 | うなり |
| Happy | 開心 | 开心 | うれしい |
| Hold | 接到下一句 | 接到下一句 | 次までのばす |
| Import script | 匯入劇本 | 导入剧本 | 台本を読み込む |
| Key | 唱名調 | 唱名调 | 階名のド |
| Lip-sync from audio | 音檔轉口型 | 音文件转口型 | 音声から口を動かす |
| Markers | 逐字標記 | 逐字标记 | マーカー |
| Metallic | 金屬 | 金属 | メタリック |
| Model | 模型 | 模型 | モデル |
| Mouth switch | 建立嘴型切換 | 创建口型切换 | 口パクをつなぐ |
| My voice… | 我的聲音… | 我的声音… | 自分の声… |
| Neutral | 中性 | 中性 | ふつう |
| New | 新增角色 | 新增角色 | キャラを追加 |
| Offline models… | 離線模型… | 离线模型… | オフラインモデル… |
| Per layer | 每層 | 每层 | レイヤーごと |
| Pitch | 音高 | 音高 | ピッチ |
| Preview | 試聽 | 试听 | 試聴 |
| Pronunciation override (optional) | 讀音覆寫（可留空） | 读音覆写（可留空） | 読み方の指定（省略可） |
| Question | 疑問 | 疑问 | ぎもん |
| Random | 隨機 | 随机 | ランダム |
| Re-flow | 重新排列 | 重新排列 | 並べ直す |
| Re-sync | 重新同步 | 重新同步 | 文字だけ更新 |
| Read selected layer | 讀取選取圖層 | 读取选中图层 | 選択レイヤーを読み込む |
| Rebuild | 重建 | 重建 | 作り直す |
| Reed | 簧片 | 簧片 | リード |
| Region | 區域 | 区域 | リージョン |
| Remove | 移除 | 移除 | 取り除く |
| Rig | 動畫控制 | 动画控制 | リグ |
| Robot | 機器人 | 机器人 | ロボット |
| Save | 儲存角色 | 保存角色 | キャラを保存 |
| Scared | 害怕 | 害怕 | こわがり |
| Seed | 種子 | 种子 | シード |
| Sensitivity | 靈敏度 | 灵敏度 | 感度 |
| Shared | 共用角色 | 共用角色 | キャラ共有 |
| Sing | 唱出來 | 唱出来 | 歌わせる |
| Sleepy | 疲倦 | 疲倦 | ねむい |
| Smoothness | 平滑 | 平滑 | なめらかさ |
| Speak | 改回講話 | 改回讲话 | しゃべりに戻す |
| Speakers | 含角色名 | 含角色名 | 話者名つき |
| Speed | 速度 | 速度 | はやさ |
| Sunny | 明亮 | 明亮 | サニー |
| Tempo | 節拍 | 节拍 | テンポ |
| Tiny | 迷你 | 迷你 | タイニー |
| Tone | 聲調 | 声调 | 声調 |
| Transpose | 移調 | 移调 | 移調 |
| Type-On | 逐字顯示 | 逐字显示 | 一文字ずつ表示 |
| Vibrato | 顫音 | 颤音 | ビブラート |
| Vibrato Rate | 顫音速率 | 颤音速率 | ビブラート速度 |
| Voice | 人聲 | 人声 | ボイス |
| Voice ID | 音色代號 | 音色代号 | ボイスID |
| Volume | 音量 | 音量 | おんりょう |
| Vowels | 判斷母音 | 判断母音 | 母音を判定 |
| Whisper | 耳語 | 耳语 | ウィスパー |
| Young | 少年 | 少年 | こども |
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

### 5.7b Lip-sync from a recording *(2.3.0)*

The mouth does not have to be driven by text. Put a WAV or AIFF in the composition, select
that layer, choose the character on the **Animation** tab, and press **Lip-sync from audio**
on the **Import** tab.

The engine reads the file, finds the syllables in it, and writes the same rig it writes for a
spoken line — so **the mouth switch, markers and head bounce all work unchanged**. Nothing
about the recording is altered and no audio is generated.

- **WAV and AIFF only.** An MP3, M4A, Ogg or FLAC is refused by name, with the fix in the
  message. AIFF matters because a stock After Effects install renders AIFF, not WAV.
- **Silence closes the mouth**, through the same pause rule a spoken line uses. Pauses need no
  handling.
- **Trim the layer and only the trimmed part is used.** A time-stretched layer is refused:
  nothing in the analysis can tell how far the stretch moved each syllable.
- **Type-On is not available** — there is no text to reveal.
- **Sensitivity** decides how much of a loudness peak counts as a syllable. Raise it when the
  mouth moves too often, lower it when it misses syllables. There is no correct value.
- **Vowels** turns vowel identification on or off. It is a guess made from the shape of the
  sound: measured against lines the engine spoke itself it agrees about two thirds of the
  time, and it is much worse with music underneath. Off gives every syllable the open shape,
  which is the plain chatter look.
- **Rebuild re-reads the file**, so after moving or re-trimming the layer, Rebuild is all that
  is needed.

If someone asks for lip-sync accurate enough for close-up dialogue, say plainly that this is a
stylised six-shape mouth driven by a guess, not a phoneme-accurate tool.

### 5.7c A real voice from a cloud model *(2.4.0)*

Select the text layers, pick a provider on the **Import** tab, press **API key** once to store
your key, then press **Cloud voice**. The provider speaks each line, the audio lands beside
the project, and the mouth is read out of that audio by the same analyser section 5.7b
describes — so this is 5.7b and Bake meeting: **a real voice, and a mouth that matches it.**

**Answer these four questions the same way every time, because they are the ones that get
asked:**

1. **Does my text leave the computer?** Yes, for the lines you select, when you press the
   button, to the provider you chose. A dialog states how many lines, how many characters and
   which provider before anything is sent, and nothing is sent if you cancel. The built-in
   voice never sends anything.
2. **Who pays?** You do, on your own account with that provider. This product includes no
   credit, no free tier and no billing relationship. It cannot spend money on any press except
   this one.
3. **Is it live?** No, and it cannot be. An audio callback cannot wait on a network without
   hanging After Effects. It is one press, one file — the same shape as Bake.
4. **Does editing the line re-fetch it?** No. The recording is muted, the built-in voice comes
   back, and the layer is marked `(stale)` until you press Cloud voice again. The mouth
   returns to the engine's timing at the same moment, so what you hear and what the mouth does
   never disagree.

- **Providers**: OpenAI, ElevenLabs and Azure Speech. The menu is read from the tool itself,
  so it always matches the installed build. Only providers returning uncompressed audio are
  offered, which is why there is no mp3 decoder in the product.
- **Voice ID and Model** are the provider's own names for these things, and each is remembered
  per provider. Leave them alone to use that provider's default. They have nothing to do with
  the **Timbre** tab, which shapes the built-in engine.
- **Region** is Azure only; its endpoint is per region. The field is disabled for the others.
- **The key** is typed hidden and kept in this computer's After Effects preferences in plain
  text — there is no key store in ExtendScript, and the panel says so rather than implying
  otherwise. It never appears on a command line. **Forget**, in the same dialog, removes it.
- **Nothing is paid for twice.** The file is named after a SHA-256 of the text, voice, model
  and settings, so re-pressing the button on an unchanged line reuses the file and makes no
  request. The readout says how many were new and how many were reused.
- **Errors are the provider's own words**, with the HTTP status. A refused key, a rate limit,
  an exhausted quota and an unreachable network say four different things, because they need
  four different fixes.
- **2000 characters a line.** Longer is refused before anything is sent.
- **Sensitivity and Vowels** apply here too: they are what the returned audio is read with.

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
| Effect parameters | **290** | A saved-project contract. Do not expect this to change. |
| Melody timing resolution | **1/96 of a beat** | Supports 64th notes (6 ticks) and 32nd triplets (8). ~5.2 ms at 120 BPM. |
| Mouth shapes | **6** | closed, a, i, u, e, o |
| Sung mouth-close threshold | **2 frames** | Frames, not seconds, so it behaves the same at any frame rate |
| Mandarin readings | **44,355** characters | |
| Bake folder | `Island Chatter Audio` | Beside the `.aep` |
| Cloud voice folder | `Island Chatter Audio\cloud` | *(2.4.0)* Beside the `.aep`. Files are named after a hash of the request, which is what makes the same line free the second time |
| Cloud voice line length | **2000 characters** | *(2.4.0)* Refused before anything is sent. Providers have their own limits; this one is free to hit |

**Backwards compatibility:** a project saved by any earlier 1.x version opens and sounds
identical. Every appended parameter has a default that reproduces the previous behaviour, and
a melody length of zero is what keeps a pre-1.7.0 project speaking. 2.0.0 changed **no audio
at all** — it is an interface release.

---

## 8. Every message the panel can show

If a user quotes something the panel said, find it here. Generated from the panel, so it is
complete and current. `{0}` and `{1}` are filled in with counts or names at runtime.

<!-- BEGIN MESSAGES -->
| English | 繁體中文 | 简体中文 | 日本語 |
| --- | --- | --- | --- |
|    OUT OF RANGE | 　　超出範圍 | 　　超出范围 | 　　範囲外 |
|   (x{0} character) | 　（x{0} 角色補償） | 　（x{0} 角色补偿） | 　（x{0} キャラ補正） |
|   ({0} sung layer(s) left in place) | 　（唱歌 {0} 層維持原位） | 　（唱歌 {0} 层维持原位） | 　（歌の {0} レイヤーはそのまま） |
|   +{0} split | 　+{0} 斷句 | 　+{0} 断句 | 　+{0} 行に分割 |
|   cast: {0} | 　角色：{0} | 　角色：{0} | 　キャラ：{0} |
|   comp grown to {0}s | 　合成延長到 {0}s | 　合成延长到 {0}s | 　コンポを {0}s に延長 |
|   eighth | 　八分 | 　八分 | 　8 分 |
|   half | 　二分 | 　二分 | 　2 分 |
|   held x{0} | 　接到下一句 x{0} | 　接到下一句 x{0} | 　次までのばす x{0} |
|   quarter | 　四分 | 　四分 | 　4 分 |
|   rig x{0} | 　控制器 x{0} | 　控制器 x{0} | 　リグ x{0} |
|   sixteenth | 　十六分 | 　十六分 | 　16 分 |
|   stale bake x{0} | 　轉檔過期 x{0} | 　导出过期 x{0} | 　書き出し古い x{0} |
| = 0s  no grid | = 0s　無格線 | = 0s　无格线 | = 0s　グリッドなし |
| Add a character on the Animation page first. | 請先在「動畫」頁新增角色。 | 请先在「动画」页新增角色。 | 先に「アニメーション」ページでキャラクターを追加してください。 |
| Applied to {0} layer(s) | 已套用 {0} 個圖層 | 已应用 {0} 个图层 | {0} レイヤーに適用しました |
| Apply Island Chatter first, then bake. | 請先按 Apply 再轉成音訊。 | 请先按 Apply 再转成音频。 | 先に適用してから書き出してください。 |
| Apply Island Chatter to these layers first. | 這些圖層還沒套用過。 | 这些图层还没应用过。 | これらのレイヤーにはまだ適用されていません。 |
| Back to the built-in voice | 已改回內建的聲音 | 已改回内建的声音 | 内蔵の声に戻しました |
| Baked {0} layer(s) -> {1} | 已轉成音訊 {0} 層 -> {1} | 已转成音频 {0} 层 -> {1} | {0} レイヤーを書き出しました -> {1} |
| Character {0} | 角色 {0} | 角色 {0} | キャラ {0} |
| Choose a MIDI file | 選一個 MIDI 檔 | 选一个 MIDI 文件 | MIDI ファイルを選ぶ |
| Choose a MIDI file first. | 請先按「選 MIDI」挑一個檔案。 | 请先按「选 MIDI」挑一个文件。 | 先に「MIDI を選ぶ」でファイルを選んでください。 |
| Choose a provider first. | 請先選一家供應商。 | 请先选一家供应商。 | 先にサービスを選んでください。 |
| Choose a recording of a held “{0}” | 請選一段拉長的「{0}」的錄音 | 请选一段拉长的「{0}」的录音 | 「{0}」を伸ばして録音したファイルを選んでください |
| Choose a track first. | 請先選一個軌道。 | 请先选一个轨道。 | 先にトラックを選んでください。 |
| Choose or create a character first. | 請先選擇或新增角色。 | 请先选择或新增角色。 | 先にキャラを選ぶか追加してください。 |
| Close | 關閉 | 关闭 | 閉じる |
| Cloud voice on {0} layer(s) via {1} | 已用 {1} 為 {0} 層配音 | 已用 {1} 为 {0} 层配音 | {1} で {0} レイヤーに声を当てました |
| Download | 下載 | 下载 | ダウンロード |
| Download failed | 下載失敗 | 下载失败 | ダウンロードに失敗しました |
| Download {0}? ⏎  ⏎ About {1} MB, once. After that this voice needs no network and no account — it runs on this computer. ⏎  ⏎ After Effects will not respond while it downloads. | 要下載{0}嗎？ ⏎  ⏎ 大約 {1} MB，只下載這一次。之後這個語音不用連網、不用帳號，完全在這台電腦上算。 ⏎  ⏎ 下載時 After Effects 會沒有反應。 | 要下载{0}吗？ ⏎  ⏎ 大约 {1} MB，只下载这一次。之后这个语音不用连网、不用账号，完全在这台电脑上算。 ⏎  ⏎ 下载时 After Effects 会没有反应。 | {0} をダウンロードしますか？ ⏎  ⏎ 約 {1} MB、一度だけです。以後この音声はネットワークもアカウントも不要で、このパソコンの中だけで動きます。 ⏎  ⏎ ダウンロード中は After Effects が応答しなくなります。 |
| Downloading… | 下載中… | 下载中… | ダウンロード中… |
| Error | 錯誤 | 错误 | エラー |
| Imported {0} layer(s) | 已匯入 {0} 層 | 已导入 {0} 层 | {0} レイヤーを読み込みました |
| Installed · {0} MB | 已安裝 · {0} MB | 已安装 · {0} MB | 導入済み・{0} MB |
| Kanji read as Chinese: {0} | 漢字以中文讀音唸出：{0} | 汉字以中文读音念出：{0} | 漢字は中国語読みです：{0} |
| Key cleared | 已清除金鑰 | 已清除金钥 | APIキーを消去しました |
| Key saved | 已存下金鑰 | 已存下金钥 | APIキーを保存しました |
| Lip-synced {0} layer(s) onto {1} | 已對嘴 {0} 層到「{1}」 | 已对嘴 {0} 层到「{1}」 | {0} レイヤーを「{1}」に口パクさせました |
| Lip-synced {0} layer(s); {1} overlap | 已對嘴 {0} 層；有 {1} 句重疊 | 已对嘴 {0} 层；有 {1} 句重叠 | {0} レイヤーを口パクさせました。{1} 件が重なっています |
| MIDI loaded: {0} — pick a track, then Sing | 已讀取 {0} —— 選好軌道後按「唱出來」 | 已读取 {0} —— 选好轨道后按「唱出来」 | MIDI を読み込みました：{0} —— トラックを選んで「歌わせる」 |
| Measured {0} vowel(s); Apply writes them onto a layer | 已量到 {0} 個母音，按 Apply 才會寫到圖層上 | 已量到 {0} 个母音，按 Apply 才会写到图层上 | 母音を {0} つ測りました。レイヤーに書き込むには「適用」を押してください |
| Model ready | 模型已就緒 | 模型已就绪 | モデルの準備ができました |
| Models live in your own user folder, so removing Island Chatter leaves them alone. After Effects stops responding while one downloads. | 模型放在你自己的使用者資料夾，所以移除 Island Chatter 不會動到它們。下載時 After Effects 會沒有反應。 | 模型放在你自己的使用者文件夹，所以移除 Island Chatter 不会动到它们。下载时 After Effects 会没有反应。 | モデルはご自身のユーザーフォルダーに保存されるため、Island Chatter を削除しても残ります。ダウンロード中は After Effects が応答しなくなります。 |
| Mouth on Time Remap | 嘴型已接上時間重映射 | 口型已接上时间重映射 | 口パクをタイムリマップにつなぎました |
| Mouth switch on {0} layer(s) -> {1} | 已接上嘴型 {0} 層 -> {1} | 已接上口型 {0} 层 -> {1} | 口パクを {0} レイヤーにつなぎました -> {1} |
| Name this character | 幫這個角色取個名字 | 帮这个角色取个名字 | キャラの名前を入れてください |
| No notes in that file | 這個檔案裡沒有音符 | 这个文件里没有音符 | このファイルに音符がありません |
| None of those were singing | 選取的圖層沒有旋律 | 选中的图层没有旋律 | 選んだレイヤーにメロディがありません |
| Not downloaded · {0} MB | 尚未下載 · {0} MB | 尚未下载 · {0} MB | 未ダウンロード・{0} MB |
| Now editing {0} | 目前角色：{0} | 目前角色：{0} | 編集中のキャラ：{0} |
| Offline model installed ({0} MB) | 離線模型已安裝（{0} MB） | 离线模型已安装（{0} MB） | オフラインモデルを入れました（{0} MB） |
| Offline models | 離線模型 | 离线模型 | オフラインモデル |
| Offline voice | 離線語音 | 离线语音 | オフライン音声 |
| Only the first {0} UTF-16 units are spoken; the rest of the Source Text was cut: ⏎  ⏎ {1} | 只會唸出前 {0} 個 UTF-16 字元，超出的 Source Text 已截斷： ⏎  ⏎ {1} | 只会念出前 {0} 个 UTF-16 字符，超出的 Source Text 已截断： ⏎  ⏎ {1} | しゃべるのは最初の {0} UTF-16 単位までです。残りのソーステキストは切りました： ⏎  ⏎ {1} |
| Open an active composition first. | 請先開啟合成。 | 请先开启合成。 | 先にコンポジションを開いてください。 |
| Overlapping lines: {0} | 台詞重疊：{0} | 台词重叠：{0} | セリフが重なっています：{0} |
| Paste a script into the text box first. | 請先把劇本貼進上面的文字框。 | 请先把剧本粘贴到上面的文本框。 | 先に台本をテキスト欄に貼り付けてください。 |
| Playing… | 播放中… | 播放中… | 再生中… |
| Previewed | 已試聽 | 已试听 | 試聴しました |
| Re-flowed {0} layer(s) @ {1} beat(s) | 已排列 {0} 層 @ {1} 拍 | 已排列 {0} 层 @ {1} 拍 | {0} レイヤーを {1} 拍あけて並べ直しました |
| Re-synced {0} layer(s) | 已重新同步 {0} 層 | 已重新同步 {0} 层 | {0} レイヤーを更新しました |
| Read settings from {0} | 已讀取設定：{0} | 已读取设置：{0} | {0} から設定を読み込みました |
| Read text only | 只讀到文字（此圖層尚未套用） | 只读到文字（此图层尚未应用） | テキストだけ読み込みました（未適用） |
| Rebuilt {0} rig(s), {1} line(s) | 已重建 {0} 組控制器、{1} 句 | 已重建 {0} 组控制器、{1} 句 | リグ {0} 組・{1} 行を作り直しました |
| Remove {0}? ⏎  ⏎ It frees about {1} MB. You can download it again at any time. | 要移除{0}嗎？ ⏎  ⏎ 會空出大約 {1} MB。之後隨時可以再下載一次。 | 要移除{0}吗？ ⏎  ⏎ 会空出大约 {1} MB。之后随时可以再下载一次。 | {0} を取り除きますか？ ⏎  ⏎ 約 {1} MB が空きます。いつでも再ダウンロードできます。 |
| Removed {0} | 已移除 {0} | 已移除 {0} | {0} を取り除きました |
| Removed {0} item(s) from {1} layer(s) | 已移除 {1} 層上的 {0} 個項目 | 已移除 {1} 层上的 {0} 个项目 | {1} レイヤーから {0} 項目を取り除きました |
| Saved {0} | 已儲存：{0} | 已保存：{0} | {0} を保存しました |
| Select a saved character first. | 請先選取自訂角色。 | 请先选中自订角色。 | 先に保存したキャラを選んでください。 |
| Select a text layer or enter text first. | 請選取文字圖層或先輸入文字。 | 请选中文本图层或先输入文字。 | テキストレイヤーを選ぶか、文字を入力してください。 |
| Select a text layer. | 請選取文字圖層。 | 请选中文本图层。 | テキストレイヤーを選んでください。 |
| Select an audio layer. | 請選取音訊圖層。 | 请选中音频图层。 | 音声レイヤーを選択してください。 |
| Select the lines to turn back into speech. | 請選取要改回講話的圖層。 | 请选中要改回讲话的图层。 | しゃべりに戻すレイヤーを選んでください。 |
| Send {0} line(s), {1} characters, to {2}? ⏎  ⏎ The text leaves this computer. Lines already fetched with the same settings are reused and cost nothing. | 要把 {0} 句、共 {1} 個字送到 {2} 嗎？ ⏎  ⏎ 文字會離開這台電腦。文字和設定都沒變的句子會直接沿用上次的檔案，不會再花錢。 | 要把 {0} 句、共 {1} 个字送到 {2} 吗？ ⏎  ⏎ 文字会离开这台电脑。文字和设置都没变的句子会直接沿用上次的文件，不会再花钱。 | {0} 行・{1} 文字を {2} に送信しますか？ ⏎  ⏎ 文字はこのパソコンの外に出ます。文字も設定も変わっていない行は前回のファイルを使い回すので、費用はかかりません。 |
| Set the API key for {0} first. | 請先設定 {0} 的 API 金鑰。 | 请先设置 {0} 的 API 金钥。 | 先に {0} の APIキーを設定してください。 |
| Speak {0} line(s), {1} characters, with {2}? ⏎  ⏎ This runs on your own computer: nothing is sent anywhere and nothing is billed. | 要用 {2} 唸出 {0} 句、共 {1} 個字嗎？ ⏎  ⏎ 這是在你自己的電腦上算的，不會送出任何東西，也不會產生費用。 | 要用 {2} 念出 {0} 句、共 {1} 个字吗？ ⏎  ⏎ 这是在你自己的电脑上算的，不会送出任何东西，也不会产生费用。 | {0} 行・{1} 文字を {2} でしゃべらせますか？ ⏎  ⏎ これはあなたのパソコンの中で動きます。どこにも送信されず、費用もかかりません。 |
| Speaking again: {0} layer(s) | 已改回講話 {0} 層 | 已改回讲话 {0} 层 | {0} レイヤーをしゃべりに戻しました |
| Speed set manually | 語速為手動設定 | 语速为手动设置 | はやさは手動設定です |
| Sung note names on {0} layer(s) | 已唱唱名 {0} 層 | 已唱唱名 {0} 层 | 階名で {0} レイヤーを歌わせました |
| Sung {0} layer(s) | 已唱出 {0} 層 | 已唱出 {0} 层 | {0} レイヤーを歌わせました |
| Sung {0} line(s) — {1} | 已唱出 {0} 句 —— {1} | 已唱出 {0} 句 —— {1} | {0} 行を歌わせました —— {1} |
| The selected layer(s) have no text in them. | 選取的圖層裡沒有文字。 | 选中的图层里没有文字。 | 選択したレイヤーに文字がありません。 |
| There are already {0} layer(s) here from an earlier MIDI import. ⏎  ⏎ Remove them first? No adds a second copy. | 這個合成裡已經有 {0} 層是之前匯入的。 ⏎  ⏎ 要先移除它們嗎？按「否」就直接再加一份。 | 这个合成里已经有 {0} 层是之前导入的。 ⏎  ⏎ 要先移除它们吗？按「否」就直接再加一份。 | このコンポには前回の MIDI 読み込みで作られたレイヤーが {0} 枚あります。 ⏎  ⏎ 先に取り除きますか？「いいえ」でもう一組追加します。 |
| There are no Island Chatter lines here. | 這個合成裡沒有台詞圖層。 | 这个合成里没有台词图层。 | このコンポにセリフのレイヤーがありません。 |
| There is no shared rig here. | 這個合成裡沒有共用控制器。 | 这个合成里没有共用控制器。 | このコンポには共有リグがありません。 |
| This build knows about no offline models. | 這個版本沒有任何離線模型。 | 这个版本没有任何离线模型。 | このビルドにはオフラインモデルがありません。 |
| This voice has no sound for these characters, so they were left out: {0} | 這個語音沒有這些字的發音，所以沒有唸出來：{0} | 这个语音没有这些字的发音，所以没有念出来：{0} | この音声には次の文字の読みがないため、読み上げられませんでした：{0} |
| Trial: the voice carries a short mark every few seconds | 試用版：聲音每隔幾秒會有一小段標記聲 | 试用版：声音每隔几秒会有一小段标记声 | 体験版：数秒ごとに短い印の音が入ります |
| Truncated: {0} | 已截斷：{0} | 已截断：{0} | 文字が切れました：{0} |
| Tuning… | 調音… | 调音… | 声の調整… |
| Type something first, or select a text layer to hear. | 請先打字，或選一個文字圖層來聽。 | 请先打字，或选一个文本图层来听。 | 先に文字を入力するか、聴きたいテキストレイヤーを選んでください。 |
| Voice tuned | 已調過音 | 已调过音 | 声を調整しました |
| truncated: {0} | 被截斷：{0} | 被截断：{0} | 切れました：{0} |
| {0} is longer than {1} characters. Split it first. | {0} 超過 {1} 個字，請先拆成幾句。 | {0} 超过 {1} 个字，请先拆成几句。 | {0} は {1} 文字を超えています。先に分けてください。 |
| {0} is missing. Reinstall Island Chatter. | 找不到 {0}，請重新安裝 Island Chatter。 | 找不到 {0}，请重新安装 Island Chatter。 | {0} が見つかりません。Island Chatter を再インストールしてください。 |
| {0} line(s) · {1} BPM | {0} 句・{1} BPM | {0} 句・{1} BPM | {0} 行・{1} BPM |
| {0} long line(s) split | 太長的句子拆成 {0} 層 | 太长的句子拆成 {0} 层 | 長い行を {0} レイヤーに分けました |
| {0} needs the region its resource is in. | {0} 需要填寫資源所在的區域。 | {0} 需要填写资源所在的区域。 | {0} にはリソースのリージョンが必要です。 |
| {0} new, {1} reused | 新增 {0}、沿用 {1} | 新增 {0}、沿用 {1} | 新規 {0} 件・再利用 {1} 件 |
| {0} note(s) dropped from chords | 和弦捨去 {0} 個音 | 和弦舍去 {0} 个音 | 和音から {0} 音を省きました |
| {0} note(s) with no syllable | {0} 個音符沒有字 | {0} 个音符没有字 | {0} 音に歌詞がありません |
| {0} of 5 vowels | 5 個母音中的 {0} 個 | 5 个母音中的 {0} 个 | 母音 5 つのうち {0} つ |
| {0} s/syllable   Speed {1} | {0} 秒／字   Speed {1} | {0} 秒／字   Speed {1} | {0} 秒／音   Speed {1} |
| {0} syllable(s) found | 找到 {0} 個音節 | 找到 {0} 个音节 | {0} 音節を検出しました |
| {0} syllable(s) with no note | {0} 個字沒有音符（用最後一個音唱完） | {0} 个字没有音符（用最后一个音唱完） | {0} 文字に音符がありません（最後の音でのばします） |
| {0} track(s) · {1} BPM | {0} 軌・{1} BPM | {0} 轨・{1} BPM | {0} トラック・{1} BPM |
<!-- END MESSAGES -->

---

## 9. Troubleshooting

**Anything from the cloud voice that starts `HTTP` *(2.4.0)***
Read the message; it is the provider's own, and each status means a different fix.
`401`/`403` — the key was refused: check it was pasted whole and belongs to the provider
selected in the menu. `402` — the account cannot be billed. `404` — the voice id or the
endpoint does not exist; for Azure that is usually the wrong region. `429` — a rate limit or
an exhausted quota, and the provider's own sentence says which. `413` — the line is too long
for that provider. `WinHTTP 12007/12029` — the machine could not reach the provider at all:
network, VPN or firewall. Do not report these as one failure; they are four different
problems.

**"island_chatter_voice.exe is missing" *(2.4.0)***
The build was installed incompletely, or an older version's folder is being used. Reinstall.

**The cloud voice worked, then the layer went `(stale)` and the built-in voice came back**
*(2.4.0)* That is the design, and it happens when the text or the voice settings changed.
Pressing Apply or Re-sync marks the recording stale rather than fetching a new one, because a
keystroke should not spend money. Press **Cloud voice** again. The mouth follows: while the
recording is muted the mouth uses the engine's timing, which is what is actually audible.

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
- **No live cloud voice.** *(2.4.0)* Cloud voice is one press, one file, and will not become a
  real-time effect: an audio callback cannot wait on a network without hanging the host, and
  the engine's determinism depends on it never trying.
- **No offline speech model.** *(2.4.0)* Running a model locally is a separate piece of work
  and is not in this release. Cloud voice needs a network and somebody else's service.
- **No key sharing, no bundled credit, no proxy.** The user's key goes from their machine to
  their provider and nowhere else. Nothing about the cloud voice touches the author's
  infrastructure, because there is none.
- **No in-panel audition.** Preview in the composition.
- **Sung pitch is absolute** and not scaled by the voice preset, so two characters singing
  together stay in the same key.

---

## 11. Answering questions well

Some guidance specific to this product:

- **Ask which language the panel is in, or give all four labels.** Users run this in
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
| `README.md` / `.en.md` / `.ja.md` | The same material for people, in three languages (the panel adds 简体中文) |
| `CHANGELOG.md` | Full version history, Traditional Chinese, written for users |
| `CLAUDE.md` | Maintainer guide and design invariants. Not a usage reference |
| `native/panel/IslandChatterNativePanel.jsx` | The panel — every label and message |
| `native/src/dsp.cpp` | The synthesis engine, Mandarin readings, kana, English syllables |
| `native/plugin/params.hpp` | The 290-parameter layout |
| `docs/gumroad-listing.md` | Storefront copy |
| `LICENSE` | Source-available terms |

---

*Generated tables in this file are produced by `node tools/build-ai-guide.js` and checked by
`npm test`, so the strings above always match the shipped panel.*
