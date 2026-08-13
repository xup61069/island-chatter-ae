# Gumroad 商品說明（繁體中文／English／日本語）

貼到 Gumroad 商品頁的 description 欄位。價格和封面在後台另外設定。
改版時記得更新最後一行的版本號——`npm test` 會核對它跟 package.json 是否一致。
詳細功能留在 GitHub 的 README，這裡只放買之前要知道的。

---

## 繁體中文

讓 After Effects 的文字圖層自己講話。內建的聲音是在 After Effects 裡即時算出來的，
不裝取樣包、不用先輸出音檔，改一個字馬上就聽得到。以中文為主，日文和英文也能唸。

- **內建的聲音完全在本機。** 不連網、不上傳、不需要帳號，關掉網路照樣工作。
- **想用雲端大模型的聲音也可以，但那一半要連網。** 你自己帶 OpenAI／ElevenLabs／Azure
  的 API 金鑰，按一次「雲端語音」，那一句的文字會送到你選的那家、回傳一個音檔。
  **文字會離開這台電腦，帳單也是你的。** 按下去之前會先跳出「這次會送出幾句、幾個字、
  送去哪裡」讓你確認；沒按就什麼都不會送。同樣的文字和設定不會重送第二次。
- **也可以下載一個神經模型，在自己的電腦上跑。** 按一次「下載模型」抓 177 MB，之後那個聲音
  不連網、不用帳號、不用金鑰，打的字一個都不會離開這台機器。它讀的是**跟內建聲音同一套**
  中文讀音——詞組、變調、注音、`[重|chong2]` 這種發音覆寫都算數。
  **要先知道：那是中國口音的普通話女聲。** 可商用授權的中文模型只有這一個，台灣國語的離線模型
  不存在。要台灣國語請用內建的聲音，或雲端 Azure 的 zh-TW 音色。
- **試聽不用先套到圖層上。** 調完音色按一下就聽得到，專案不會多出任何東西。
- **日文也可以離線。** 另外一個模型，假名和常用漢字都唸得出來——今日、日本、私。
- **可以用你自己的聲音當音色。** 錄五個拉長的母音，引擎就用你嘴巴的形狀講話；
  聲調、長短、嘴型還是引擎算的，所以中文的四聲不會被拉平。
- **有試用版**：功能一樣，算出來的聲音每隔幾秒會有一小段標記聲。
- **音檔可以直接轉成口型。** 真人配音、自己錄的、雲端回來的都一樣：引擎讀出裡面的音節，
  寫出跟講話的句子一模一樣的控制器，嘴型切換、逐字標記、頭部晃動全部照舊。
- **匯入 MIDI，角色就會唱歌。** 貼歌詞、選一軌，一個字一個音，落在 MIDI 自己的時間上。
  長音撐得住，聲調讓位給旋律，抖音會慢慢浮上來。歌詞打一個 `-` 就是拖腔。
  不給歌詞就唱唱名 do re mi，固定調首調都可以。力度照 MIDI 走，強弱有起伏。
- **貼一整份劇本，一行變一層**，套好聲音、依序排好。劇本裡寫「咪咪：早安」就自動分角色，
  名字不會被唸出來。
- **間隔用拍算。** 1 是四分音符，0.5 是八分音符，每一句都落在拍點上。
  字幕還可以留到下一句才消失，中間不會空畫面。
- **改字不會弄壞聲音。** 重新同步只更新文字和長度，跨角色一起選也不會被蓋掉；
  重新排列會讓後面的句子自己讓位。
- **一個角色的嘴巴綁一次。** 二十句台詞共用一組控制器，由當下正在講話的那一句驅動。
  嘴型圖層或嘴型合成按一下就接好。
- 8 種聲線、7 種情緒、4 種體型，共鳴、發聲源、顫音都能調。
  固定隨機種子，同樣的設定永遠是同樣的聲音。
- 中文 44,355 個漢字讀音，支援注音、拼音與行內讀音覆寫。
- 一鍵轉成音訊，播放零運算，專案給沒裝外掛的人也聽得到。
- **面板整個介面有繁體中文、简体中文、English、日本語四種語言**——按鈕、狀態訊息、警告視窗、
  滑鼠停著跳出來的說明，全部都翻。

**需要 Windows 10／11 x64，以及 After Effects 2025 或 2026。沒有 macOS 版。**
**雲端語音需要你自己的 API 金鑰，本產品不含任何額度。**

---

## English

Give an After Effects text layer its own voice. The built-in voice is generated inside After
Effects: no sample pack to install, no file to export first, and changing a word changes what
you hear. Built for Chinese first; it speaks Japanese and English too.

- **The built-in voice is entirely local.** No network, no upload, no account. It works with
  the machine offline.
- **A cloud model can speak the line instead, and that half does use the network.** Bring your
  own OpenAI, ElevenLabs or Azure API key, press Cloud voice, and that line's text is sent to
  the provider you chose, which returns an audio file. **The text leaves your computer and the
  bill is yours.** Before anything is sent you are shown how many lines, how many characters
  and which provider; nothing goes anywhere until you confirm. The same text with the same
  settings is never paid for twice.
- **Or download a neural model and run it on your own machine.** One press fetches 177 MB;
  after that the voice needs no network, no account and no key, and nothing you type leaves the
  computer. It reads Chinese with **the same reader the built-in voice uses**, so phrases, tone
  sandhi, Zhuyin and inline `[重|chong2]` pronunciation overrides all count.
  **Know before you fetch it: it is Mandarin as it is spoken in China, by a woman.** It is
  the only Chinese model with a licence that allows this, and no Taiwanese-accented offline
  model exists. For Taiwan Mandarin, use the built-in voice or Azure's zh-TW voice.
- **Hear a voice before you apply it.** Preview plays the line straight from the panel and
  leaves nothing behind in the project.
- **Japanese runs offline too**, as a second model, and it reads common kanji as well as
  kana — 今日, 日本, 私.
- **Or speak in the shape of your own voice.** Record five held vowels and the engine takes
  your vocal tract; the tones, the timing and the mouth shapes are still the engine's, so a
  Mandarin fourth tone still falls.
- **There is a trial**: everything works, and the audio it renders carries a short mark
  every few seconds.
- **Any recording can drive the mouth.** A real voice actor, something you recorded yourself,
  or the file a cloud model just sent back — the engine finds the syllables in it and writes
  exactly the controls a spoken line writes, so mouth shapes, per-syllable markers and the head
  bounce all work unchanged.
- **Import a MIDI file and the character sings.** Paste the lyrics, pick a track, and every
  syllable takes a note at the time the file says. Long notes are held, tones give way to the
  melody, and vibrato grows in. A `-` in the lyric holds a syllable over. Give it no
  lyric and it sings the note names instead, fixed or movable do. Velocity is followed,
  so a phrase has dynamics.
- **Paste a whole script, get one layer per line**, voiced and laid out in sequence. Write
  `Mimi: Good morning` and the line joins that character without the name being spoken.
- **Gaps are note values.** 1 is a crotchet, 0.5 a quaver, and every line lands on the beat.
  Lines can also hold on screen until the next one starts, so nothing flickers.
- **Editing text will not repaint your voices.** Re-sync updates text and length only; Re-flow
  moves everything after an edited line out of the way.
- **Bind a character's mouth once.** Twenty lines share one set of controls, driven by whichever
  line is speaking. One click wires up your mouth layers or a mouth precomp.
- 8 voices, 7 emotions, 4 character sizes, with formant, sound source and vibrato on their own
  sliders. Fix the seed and the same settings always give the same voice.
- 44,355 Chinese readings, with Pinyin, Bopomofo and inline pronunciation overrides.
- One-click bake to audio: playback costs nothing and the project plays for someone without the
  plug-in.
- **The panel is in 繁體中文, 简体中文, English and 日本語** — labels, status messages, alerts and every
  tooltip, not just the buttons.

**Requires Windows 10/11 x64 and After Effects 2025 or 2026. There is no macOS build.**
**Cloud voices need your own API key; no credit of any kind is included.**

---

## 日本語

After Effects のテキストレイヤーにそのままの声を持たせます。内蔵の声は After Effects の中で
生成されるので、サンプル素材のインストールも、先に音声ファイルを書き出す必要もありません。
文字を直せば聞こえ方もその場で変わります。中国語が主軸で、日本語と英語もしゃべります。

- **内蔵の声は完全にこのパソコンの中だけで動きます。** 通信なし、アップロードなし、
  アカウントも不要。ネットワークを切ったままでも使えます。
- **クラウドのモデルにしゃべらせることもできますが、そちら半分は通信します。**
  OpenAI・ElevenLabs・Azure の APIキーはご自身のものをお使いください。「クラウド音声」を
  押すと、その行の文字が選んだサービスに送られ、音声ファイルが返ってきます。
  **文字はこのパソコンの外に出ますし、料金もあなたに請求されます。** 送信の前に
  「何行・何文字・どこへ」が表示され、確認するまで何も送られません。
  同じ文字と同じ設定なら二度は課金されません。
- **どんな録音からでも口を動かせます。** プロの声優でも、自分で録った声でも、
  クラウドから返ってきたファイルでも同じです。エンジンが音節を見つけ、
  しゃべらせた行とまったく同じ制御を書くので、口の形も文字ごとのマーカーも頭の揺れも
  そのまま動きます。
- **MIDI を読み込めばキャラクターが歌います。** 歌詞を貼ってトラックを選ぶだけで、
  1 文字が 1 音を取り、MIDI 自身の時間に並びます。長い音は伸び、声調はメロディーに譲り、
  ビブラートがふくらみます。歌詞の `-` で同じ音節を次の音まで伸ばせます。
  歌詞を与えなければ階名（ドレミ）で歌います。ベロシティも反映されます。
- **ニューラルモデルをダウンロードして、自分のパソコンで動かすこともできます。** 一度 177 MB を
  取得すれば、以後はネットワークもアカウントもキーも不要で、入力した文字がこのパソコンの外に
  出ることはありません。中国語の読みは**内蔵音声とまったく同じ**仕組みで、熟語・声調変化・
  注音・`[重|chong2]` の読み指定がそのまま効きます。
  **取得前にご確認を：声は中国の標準中国語（普通話）を話す女性です。** 商用利用できるライセンスの
  中国語モデルはこれだけで、台湾なまりのオフラインモデルは存在しません。
- **適用する前に試聴できます。** パネルからそのまま再生され、プロジェクトには何も残りません。
- **日本語もオフラインで**。もう一つのモデルで、仮名だけでなく常用漢字も読めます。
- **自分の声の形で話させることもできます。** 母音を 5 つ録音すると、エンジンがその声道を使います。
  声調も長さも口の形もエンジンのままなので、中国語の声調は平らになりません。
- **体験版があります**：機能は同じで、生成された音声に数秒ごとに短い印が入ります。
- **台本をまるごと貼れば 1 行が 1 レイヤー**になり、声が乗って順番に並びます。
  「ミミ：おはよう」と書けば名前は読まれず、その行がそのキャラに割り当てられます。
- **間隔は音符の長さで指定。** 1 が 4 分音符、0.5 が 8 分音符。どの行も拍に乗ります。
  文字を次のセリフまで残すこともできます。
- **文字を直しても声は塗り替わりません。** 文字だけ更新はテキストと長さだけを直し、
  並べ直すで以降のセリフが自分で場所を空けます。
- **口パクをつなぐのは一度だけ。** 20 行が 1 セットの制御を共有し、
  いましゃべっているセリフがそれを動かします。口パクレイヤーもコンポもボタン一つ。
- 8 種類のボイス、7 種類の感情、4 種類の体格。共鳴・音源・ビブラートは個別に調整でき、
  シードを固定すれば同じ設定から必ず同じ声が出ます。
- 中国語は 44,355 字の読みに対応。注音・ピンイン・行内での読み指定も可能。
- ワンクリックで音声ファイル化。再生は無負荷で、プラグインの無い相手にも聞こえます。
- **パネルは 繁體中文・简体中文・English・日本語 の四言語。** ボタンだけでなく、ステータス表示も
  警告も、マウスを乗せると出る説明もすべて日本語になります。

**Windows 10／11 x64 と After Effects 2025 または 2026 が必要です。macOS 版はありません。**
**クラウド音声にはご自身の APIキーが必要で、利用枠は一切含まれません。**

---

Source-available: read the code, build it, use it commercially. Redistributing the compiled
build is not permitted. An original procedural synthesizer containing no audio assets and no
Nintendo or *Animal Crossing* audio; not affiliated with Adobe, Nintendo, OpenAI, ElevenLabs
or Microsoft.

Version 3.3.0
