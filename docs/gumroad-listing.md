# Gumroad 商品說明（繁體中文／English／日本語）

貼到 Gumroad 商品頁的 description 欄位。價格和封面在後台另外設定。
改版時記得更新最後一行的版本號。詳細功能留在 GitHub 的 README，這裡只放買之前要知道的。

---

## 繁體中文

讓 After Effects 的文字圖層自己講話。不輸出音檔、不裝取樣包，聲音在 AE 裡即時算出來，
改一個字馬上就聽得到。以中文為主，日文和英文也能唸。

- **匯入 MIDI，角色就會唱歌。** 貼歌詞、選一軌，一個字一個音，落在 MIDI 自己的時間上。
  長音撐得住，聲調讓位給旋律，抖音會慢慢浮上來。歌詞打一個 `-` 就是拖腔。
  不給歌詞就唱唱名 do re mi，固定調首調都可以。力度照 MIDI 走，強弱有起伏。
- **貼一整份劇本，一行變一層**，套好聲音、依序排好。劇本裡寫「咪咪：早安」就自動分角色，
  名字不會被唸出來。
- **間隔用拍算。** 1 是四分音符，0.5 是八分音符，每一句都落在拍點上。
- **改字不會弄壞聲音。** 重新同步只更新文字和長度，跨角色一起選也不會被蓋掉；
  重新排列會讓後面的句子自己讓位。
- **一個角色的嘴巴綁一次。** 二十句台詞共用一組控制器，由當下正在講話的那一句驅動。
  嘴型圖層或嘴型合成按一下就接好。
- 8 種聲線、7 種情緒、4 種體型，共鳴、發聲源、顫音都能調。
  固定隨機種子，同樣的設定永遠是同樣的聲音。
- 中文 44,355 個漢字讀音，支援注音、拼音與行內讀音覆寫。
- 一鍵轉成音訊，播放零運算，專案給沒裝外掛的人也聽得到。

**需要 Windows 10／11 x64，以及 After Effects 2025 或 2026。沒有 macOS 版。**

---

## English

Give an After Effects text layer its own voice. No audio files to export, no sample pack to
install: the sound is generated inside After Effects, so changing a word changes what you hear.
Built for Chinese first; it speaks Japanese and English too.

- **Import a MIDI file and the character sings.** Paste the lyrics, pick a track, and every
  syllable takes a note at the time the file says. Long notes are held, tones give way to the
  melody, and vibrato grows in. A `-` in the lyric holds a syllable over. Give it no
  lyric and it sings the note names instead, fixed or movable do. Velocity is followed,
  so a phrase has dynamics.
- **Paste a whole script, get one layer per line**, voiced and laid out in sequence. Write
  `Mimi: Good morning` and the line joins that character without the name being spoken.
- **Gaps are note values.** 1 is a crotchet, 0.5 a quaver, and every line lands on the beat.
- **Editing text will not repaint your voices.** Re-sync updates text and length only; Re-flow
  moves everything after an edited line out of the way.
- **Bind a character's mouth once.** Twenty lines share one set of controls, driven by whichever
  line is speaking. One click wires up your mouth layers or a mouth precomp.
- 8 voices, 7 emotions, 4 character sizes, with formant, sound source and vibrato on their own
  sliders. Fix the seed and the same settings always give the same voice.
- 44,355 Chinese readings, with Pinyin, Bopomofo and inline pronunciation overrides.
- One-click bake to audio: playback costs nothing and the project plays for someone without the
  plug-in.

**Requires Windows 10/11 x64 and After Effects 2025 or 2026. There is no macOS build.**

---

## 日本語

After Effects のテキストレイヤーにそのままの声を持たせます。音声ファイルの書き出しも、
サンプル素材のインストールも不要。音は After Effects の中で生成されるので、
文字を直せば聞こえ方もその場で変わります。中国語が主軸で、日本語と英語もしゃべります。

- **MIDI を読み込めばキャラクターが歌います。** 歌詞を貼ってトラックを選ぶだけで、
  1 文字が 1 音を取り、MIDI 自身の時間に並びます。長い音は伸び、声調はメロディーに譲り、
  ビブラートがふくらみます。歌詞の `-` で同じ音節を次の音まで伸ばせます。
  歌詞を与えなければ階名（ドレミ）で歌います。ベロシティも反映されます。
- **台本をまるごと貼れば 1 行が 1 レイヤー**になり、声が乗って順番に並びます。
  「ミミ：おはよう」と書けば名前は読まれず、その行がそのキャラに割り当てられます。
- **間隔は音符の長さで指定。** 1 が 4 分音符、0.5 が 8 分音符。どの行も拍に乗ります。
- **文字を直しても声は塗り替わりません。** 文字だけ更新はテキストと長さだけを直し、
  並べ直すで以降のセリフが自分で場所を空けます。
- **口パクをつなぐのは一度だけ。** 20 行が 1 セットの制御を共有し、
  いましゃべっているセリフがそれを動かします。口パクレイヤーもコンポもボタン一つ。
- 8 種類のボイス、7 種類の感情、4 種類の体格。共鳴・音源・ビブラートは個別に調整でき、
  シードを固定すれば同じ設定から必ず同じ声が出ます。
- 中国語は 44,355 字の読みに対応。注音・ピンイン・行内での読み指定も可能。
- ワンクリックで音声ファイル化。再生は無負荷で、プラグインの無い相手にも聞こえます。

**Windows 10／11 x64 と After Effects 2025 または 2026 が必要です。macOS 版はありません。**

---

Source-available: read the code, build it, use it commercially. Redistributing the compiled
build is not permitted. An original procedural synthesizer containing no audio assets and no
Nintendo or *Animal Crossing* audio; not affiliated with Adobe or Nintendo.

Version 1.8.0
