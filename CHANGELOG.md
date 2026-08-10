# Changelog

## 1.10.0 - 2026-08-10

**講話的嘴型預設變了。** 舊的樣子還在，勾一下就回得來，但預設不再是它。

- **嘴巴只在真的有停頓的地方閉。** 以前每個音節都在 82% 的位置閉一次。一句十個字的台詞，
  那是**開合 19 次、嘴巴有 41% 的時間是閉的**——「一直切到閉嘴圖層」。現在連著的字之間只換
  嘴型，只有標點停頓和句尾才回 0：同一句剩 5 次、27%，而那 5 次都落在該閉的地方。
- **想要舊的樣子，勾「Chatter／逐字開合」。** 動畫控制那一排。原本的規則一個關鍵影格都沒
  改，`validate-script.js` 照樣逐格釘住 1.3.0 的輸出——只是現在釘的是勾起來的那條路徑。
- **唱歌的句子不受這個勾選影響**，一律用停頓規則。那裡的短閉嘴比一個影格還短（1.9.1 修的
  就是這個），是逐格取樣的產物，不是可以選的風格。
- **舊專案要按下去才會變。** 關鍵影格不會自己重寫：共用控制器按 Rebuild／重建，每層控制器
  重新 Apply 或 Re-sync。在那之前既有的動畫原封不動。

## 1.9.1 - 2026-08-10

- **唱歌時嘴巴不再一直閉起來。** 嘴型軌本來是每個音節都在 82% 的地方閉一次，閉起來的長度
  等於「這個音的 18%」加上「後面到下一個音的空隙」。講話時空隙很大（標點停頓），閉嘴是一段
  看得見的休息，那就是 chatter 該有的樣子；唱歌時音符貼在一起，只剩那 18%。實測一條 5.43 秒
  的歌：**閉嘴 36 次，其中 24 次短於 30fps 的一格**。Hold 關鍵影格是逐格取樣的，所以哪幾次
  被抓到完全看運氣——嘴巴不是在閉，是在抽搐。修好之後同一條線閉 2 次、沒有任何一次短於一格，
  開合切換從 23 次降到 1 次。
- **改用「空隙」而不是「比例」。** 唱歌的句子只有在後面的靜音**至少兩格**時才閉嘴，否則直接
  換嘴型接下去。門檻用格數是因為這個問題本來就是逐格取樣的產物，用秒會在別的影格率上重演。
  句子結束一定閉；句中真的有休止符也會閉。
- **長音不會唱到一半把嘴巴關起來。** 兩秒的音以前會在 1.64 秒的地方閉 0.36 秒。
- **唱歌時的晃頭上限 0.12 秒。** `IC Head Bounce` 本來是在音長的 38% 回到 0，一個四拍的音
  會變成 0.76 秒的慢速傾斜，而且左右逐音節交替，長音就只剩一次緩慢歪頭。
- **講話的動畫一個關鍵影格都沒動。** 新規則綁在「這一句有旋律」上，不是全域換掉——
  `validate-script.js` 原本就逐個關鍵影格釘住 1.3.0 的輸出，那組測試原封不動照樣通過。

## 1.9.0 - 2026-08-09

- **Hold／接到下一句。** 匯入劇本時勾起來，每一句的字會留到下一句開始才消失，而不是講完
  就不見。配合長度是照語音的長短切的——聲音對，字幕不對：兩句之間空一拍，畫面就跟著空一拍，
  整段讀起來一閃一閃的。
- **只會延長，不會縮短。** 間隔填 0、或兩句本來就重疊的情況完全不受影響；最後一句維持自己
  的長度，因為後面沒有東西可以接。
- **「重新排列」也會照這個設定重新接好。** 不然改完一句按下重新排列，所有的接續就被默默
  還原了——而那正是改完稿之後第一個會按的按鈕。
- 聲音完全不變：語音結束之後那一段是靜音，Tone 本來就是 0 電平。

## 1.8.0 - 2026-08-09

唱歌的三個補強，外加一個真的會咬人的截斷。

- **唱名不再被截斷。** 一層最多 128 個字，而 `sol ` 就佔 4 個——64 個音名大約 199 個字，
  超過的部分被 After Effects 默默切掉，圖層拿到一整排音符卻只唱得出一半的名字。以前只用
  64 格旋律預算收斂，沒算文字。現在兩個預算一起看，照樣優先切在小節線上。用一個 375 個
  音符的和弦檔重現過：原本 2 層各 167 和 199 個字，現在 4 層最長 126 個字，142 個音一個
  都沒掉。
- **時間精度變細四倍。** 一格從 1/24 拍改成 1/96 拍，支援 64 分音符（6 格）和 32 分三連音
  （8 格）。120 BPM 下解析度從 20.8 毫秒變成 5.2 毫秒，手彈進去沒對格線的 MIDI 也保得住。
  渲染成本完全沒變——格子只是換算成取樣數，不影響合成。
- **支援力度。** MIDI 的 velocity 會變成每個音的音量，同一句話有強有弱。曲線在 127 的地方
  剛好是 1.0，所以整首都是滿力度的檔案聽起來跟沒有力度時一模一樣；最弱的音也還留 45%，
  卡通聲太小聲就聽不見了。
- **按兩次「唱出來」會先問。** 以前會直接再疊一整份，而且沒有任何提示。現在偵測到上次匯入
  留下的圖層就問要不要先移除，按「否」還是可以疊第二份。
- **「Speak / 改回講話」。** Apply 是故意不清掉旋律的（免得誤刪一整首歌），代價是也沒辦法
  拿掉。這個按鈕把選取圖層的旋律清掉、長度改回講話的長短，聲音設定完全不動。
- **「重新排列」不再毀掉歌的時間。** 唱歌圖層屬於 MIDI 自己的時間，Re-flow 會跳過它們並
  在狀態列說跳過幾層，其他台詞照常排好。
- **引擎會讀拍號了**（`FF 58`），換拍號的地方重新起一個小節，沒寫拍號就當 4/4。
- 效果器參數從 215 個增加到 279 個。**1.7.0 的專案完全不受影響**：新的一段讀成 0 就是
  沒有力度、沒有額外長度，而因為格子細了四倍，舊的粗格數字乘四剛好還是同一個長度。

## 1.7.0 - 2026-08-09

角色會唱歌了。

- **Import MIDI / 匯入 MIDI.** 選一個 MIDI 檔，挑一軌，把文字框裡的歌詞唱成那條旋律。
  一行歌詞一層，每一層放在它自己第一個音符的時間上——匯入 MIDI 不看間隔格線，歌要對在
  它自己的時間上。一個字配一個音依序發下去，長度一律配合旋律，標記、角色綁定、逐字顯示
  和配合長度全部照舊跟著計畫走，不必為唱歌另外設定。
- **音高照 MIDI 寫的唱，不跟聲線走。** 聲線的音域從 0.66 到 1.42，如果讓它參與，同一條
  旋律換個角色就會差到五度，兩個角色也不可能合唱。角色的差別在共鳴和音色，跟真人一樣。
  另外有一個**移調**欄位，整條旋律一起搬。
- **長音撐得住。** 以前每個字固定約 0.19 秒就收掉，一個兩秒的長音會變成短短一聲加一秒半
  的安靜。現在母音持續發聲，只有頭尾淡入淡出，雙母音的滑移在 90 毫秒內走完然後定住——
  一秒的「啊」是一個持續的「啊」，不是一個被拉長的滑音。
- **聲調讓位給旋律，但沒有消失。** 唱歌時音高由旋律決定，完整的四聲會跟旋律打架。四聲
  現在變成每個音的起音方向：四聲從上面滑下來，二聲從下面滑上來，聽起來還是中文咬字，
  音準是旋律的。比例可調，預設 15%。
- **抖音會慢慢浮上來，換音之間會滑。** 音拉長超過設定的秒數之後顫音才長出來，兩個音之間
  預設滑 40 毫秒。這兩個是「像人唱」跟「像機器唱」的差別。
- **一字多音（拖腔）。** 歌詞裡打一個 `-`，代表前一個字延續唱到下一個音。它只在有旋律時
  才這樣讀，所以平常台詞裡的連字號行為完全沒變。一個拖了三個音的字仍然只有一個標記、
  一次嘴型、一個逐字顯示步驟。
- **文字框空白就唱唱名。** 沒有歌詞不再是錯誤：旋律會唱出自己的音名，一個音一個字，
  在長休止的地方自動斷句成好幾層。旁邊的 **Key／唱名調** 決定哪個音是 Do——留在 C 就是
  固定調，選 G 就是首調，整組唱名跟著移，音高完全不變。黑鍵沿用下面那個白鍵的名字。
  唱名是生成成圖層真正的文字，所以標記、嘴型、逐字顯示全部照舊，**沒有增加任何參數**。
- **太長的句子拆成好幾層，不再截斷。** 一層最多 64 個音符格、128 個字，超過的部分以前是
  直接丟掉（歌詞那半還是默默丟的）。現在會拆成下一層繼續唱，而且**優先切在小節線上**——
  引擎現在讀 MIDI 的拍號，遇到裝不下就往回退到最近的一條小節線，切在小節中間看起來像出錯，
  切在小節線上看起來像一句。切點不會落在讀音覆寫 `[重|chong2]` 中間，也不會把字切一半。
  拆了幾層會寫在狀態列。
- **和弦只取最高音**，並回報捨棄了幾個音。音符和字數對不上時也會說：多的字用最後一個音
  唱完，多的音符空著，兩種都寫在狀態列，不會默默處理。
- **長音在內部切成 0.25 秒的分段。** 這是效能問題不是音色問題：懶渲染的單位是一個事件，
  一個四秒的長音只要被任何一個音訊區塊碰到,整整四秒都會在音訊執行緒上算出來,正好是
  `Utterance` 當初存在要消除的那種卡頓。相位、顫音和固定振盪器全部改用「音符內的絕對
  時間」計算，接縫因此聽不出來。
- 效果器參數從 145 個增加到 215 個。**舊專案完全不受影響**：旋律長度預設為 0，就是原本
  的講話路徑，一個位元都沒變。

## 1.6.1 - 2026-08-06

- **The tempo subdivision menu showed four identical entries.** Its items were written
  "1 / beat" through "4 / beat", and the interface translator keeps one side of anything
  containing " / " — so all four became the single word "beat" in Chinese, and four bare
  numbers in English. Broken since the trilingual panel shipped in 1.2.0; the control worked
  the whole time, which is why nothing noticed. `npm test` now localises every menu in the
  panel and fails if two entries in one menu collapse to the same label.
- **The import gap is a note value and fractions now do something.** 1 is a crotchet, 0.5 a
  quaver, 0.25 a semiquaver, and the grid lines are as fine as the number asks for. Until now
  every line snapped to a whole beat whatever the gap was, so half a beat and a whole beat
  landed in the same place most of the time and decimals looked unsupported. A gap of a beat
  or more still lands on ordinary beats, because "leave two beats" means any beat two beats
  away rather than only every second one. A gap of 0 now runs the lines straight on instead of
  snapping to the next beat.
- The readout beside the gap names the note value as well as the length.

## 1.6.0 - 2026-08-06

The edit cycle: change a line, put the scene back in order, on the beat.

- **Re-sync / 重新同步** updates the selected lines from their own Source Text and **does not
  touch the voice**. Apply rewrites every selected layer with whatever the panel is showing,
  which silently repaints a two-character selection into one voice, and repaints any layer
  applied before the sliders were last nudged. Editing text is the common case and should not
  require putting the panel back the way it was. Only what a layer already has is rebuilt: a
  line with no markers does not gain any. The length is always refitted, and the composition
  grows if the longer line no longer fits — a line clamped at the end of the composition is
  squashed to whatever room was left.
- **Re-flow / 重新排列** lays the selected lines out again end to end, using each one's real
  length. Import produces a tidy scene exactly once; after that, one edited line is longer,
  one deleted line leaves a hole, and everything after it has to be dragged. Nothing selected
  means the whole composition. The first line stays where it is apart from being pulled onto
  the beat. Running it twice changes nothing.
- **The gap is measured in beats now, and lines land on beats.** It is a minimum rather than a
  distance: the next line starts on the first beat that is at least the gap away. Converting
  beats to seconds and adding them would put nothing on the grid, because a line is only a
  whole number of beats long when Tempo Lock is on.
- **Speakers / 含角色名.** With it ticked, `咪咪：早安` is read as a line spoken by 咪咪: the
  name is not spoken, and the line joins that character's shared rig, which is created if it
  does not exist yet. A whole two-hander goes in as one paste. It is off by default on
  purpose — nothing separates `咪咪：早安` from `注意：這裡很危險`, and guessing would invent a
  character called 注意 and eat the word out of the line.
- **A bake that no longer matches its line is muted rather than left lying.** Baking silences
  the live effect, so after an edit the layer played a recording of what it used to say and
  nothing said so. Now the recording is muted, the live effect comes back on, and the layer is
  marked `(stale)` until it is baked again. It is not re-baked automatically: releasing an
  imported WAV needs `app.purge()`, so that would throw away the undo history on every Apply.
- **Baked audio is found by a Layer Control, not by its name**, so renaming a line no longer
  orphans its recording — and Import names every layer after its own text. Re-flow moves the
  audio with its line, and Remove takes it away with everything else. The WAV on disk is left
  alone.

## 1.5.0 - 2026-08-06

A whole script in one go, and a panel that remembers.

- **Import script / 匯入劇本.** Paste a script into the text box and press it: one layer per
  line, each one applied with the current voice and laid end to end from the current time,
  with a **Gap / 間隔** you set. Building a twenty-line scene was twenty rounds of new layer,
  paste, drag, Apply. Fit Duration is forced on for an import whatever the checkbox says,
  because laying lines end to end means knowing where each one ends, and only the engine's
  plan knows that. Blank lines are skipped.
- The composition is **extended if the script does not fit**, and only as far as the script
  actually needs. A line placed past the end of a composition gets its length clamped to
  nothing, so the alternative was silently swallowing half the scene.
- **A line too long for the transport becomes several layers** instead of being cut off at
  128 UTF-16 units. The break goes to the last punctuation before the limit — where the
  voice was going to rest anyway — and never through a pronunciation override or a surrogate
  pair. Pressing Apply on a layer *you* typed still truncates and says so; rewriting text
  someone typed is a different matter from laying out text they pasted.
- Importing straight into a shared character rig works: every line joins it and the rig is
  merged once at the end rather than once per line.
- **The panel remembers what it was set to.** Every voice control, the tempo, all four
  workflow checkboxes, the rig mode, the Type-On curves and the import gap survive a restart.
  Until now only the interface language and saved characters did, so a project spread over
  several days meant setting it all up again every morning.

## 1.4.0 - 2026-08-06

One rig for a whole character, however many lines they have.

- **A shared animation rig.** Until now every line grew its own `IC Mouth`,
  `IC Volume`, `IC Pitch`, `IC Head Bounce` and `IC Blink`, so a scene of twenty
  lines was twenty sets of sliders and there was no way to bind one character's
  mouth to all of them. Pick **Shared / 共用角色** instead of **Per layer / 每層**,
  name a character, and the sliders live on one null of their own, driven by
  whichever line is speaking at that moment. Bind the face once.
- **The rig holds keyframes, not expressions.** Nothing is evaluated while you
  play back, the project animates on a machine with no plug-in installed, and a
  rig whose lines have been deleted goes stale rather than turning into a
  yellow error. The price is that moving a line does not move the rig with it,
  which is what **Rebuild / 重建** is for — it re-merges from whatever the lines
  are doing now, without touching the voice.
- Two more tracks a shared rig can answer that a single line cannot:
  **IC Speaking** is 100 while anyone is talking and 0 between lines, and
  **IC Line** says which line that is. Idle animation and per-line switching
  both need them.
- **Blinks and head bounces count across the whole character**, not from the
  start of each line. Counted per line the head is thrown the same way at every
  line's first syllable, which reads as a tic rather than a face.
- **Two lines of one character at once** still build. The later one wins from
  the moment it starts, the earlier one is cut there instead of closing the
  mouth in the middle of the later one, and the panel names both on the status
  line.
- **The character's voice travels with the project.** Saved characters live in
  After Effects' preferences, so they vanish when the project moves to another
  machine; a shared rig stores its voice on its own layer, and picking the
  character loads it back.
- **Mouth switch / 建立嘴型切換** wires a face to the rig. Select one precomp of
  six frames and it drives Time Remap; select up to six layers and it switches
  their Opacity, topmost first. `IC Mouth` is 0 for closed and 1-5 for a, i, u,
  e and o — a mapping that until now was written down nowhere the user could
  see it.
- Lines point at their rig through a Layer Control, so renaming the character
  or reordering the composition cannot break the link, and **Remove** reaches
  everything: take a line off and the rig is rebuilt without it, take the rig
  off and every line and every mouth layer is unbound.

## 1.3.0 - 2026-08-05

English, and twice as much room for it.

- **English is syllabified a word at a time** instead of pairing each consonant with the
  vowel after it. Spelling only means anything at word scale — though, through and tough
  share four letters and no sounds — and the old approach gave "strength" four syllables.
  Handled: vowel digraphs, the silent final e and the length it implies, consonant digraphs
  that must not be split (mo-ther, never mot-her), the glide letters that decide whether a
  syllable ends or a new one begins (brown against flo-wer, day against pla-yer), and
  word-final l, m and n that are syllables without a vowel of their own (rhy-thm, lit-tle).
- **Stress.** The stressed syllable is longer and higher; unstressed ones shorten to roughly
  half and reduce to a schwa. That alternation is most of what makes speech sound like
  English rather than like a list of syllables. Tempo Lock flattens it, because a beat grid
  and a stress pattern cannot both be satisfied and the grid is what was asked for.
- This is **not a pronunciation dictionary** and does not pretend to be one. The published
  NRL letter-to-sound rules would be the obvious choice, but there are over three hundred of
  them and reproducing them from memory would introduce errors nothing here could detect.
  What this gets right is the syllable count, the vowel colour and the stress, which is what
  a character voice needs.
- **The text limit doubles to 128 UTF-16 units.** Sixty-four is a whole sentence in Chinese
  but about ten words in English. The second block is appended at index 81; the indices in
  between were published before it existed and cannot move.

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
