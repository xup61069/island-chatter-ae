# Changelog

## 3.3.0 - 2026-08-14

**離線模型從一顆按鈕變成一個地方。**

3.2.0 有個「下載模型」按鈕，抓的是**語音來源清單裡選著的那一列**——而那個清單故意只列
**已經裝好**的模型（列出一個按下去會失敗的選項，讀起來像功能壞掉）。所以任何人第一次按那顆按鈕，
得到的都是「請先在來源清單選一個要下載的離線模型」，而清單裡一個都沒有。**死路，而且出不來。**

現在按鈕打開一個視窗，列出這個版本知道的**每一個**模型，不管裝了沒有：

- 名字、大小、裝了沒有。
- 中文那個底下直接寫著它是中國口音的普通話女聲，還有要台灣國語該用什麼——
  **在你決定要不要花 177 MB 之前，不是之後。**
- 一顆按鈕：沒裝的話是「下載」，裝了的話是「移除」。**移除會問一次**，177 MB 要抓二十分鐘。
- 下載完會**自動選好那個來源**，所以你下一步按的就是你本來要按的那顆。

工具多了兩個模式：`--models` 回報整份目錄（裝了沒有、多大、放在哪），`--remove` 只刪它自己抓的
那三個檔案，資料夾裡有別的東西就留著、資料夾也不刪——**用字串拼出來的路徑做萬用字元刪除，
就是刪錯資料夾的方法**。

**清單和目錄是兩個不同的問題，現在有兩個不同的答案。** 選單只提供今天能用的東西（`--providers`
沒有變），目錄告訴你有什麼東西存在（`--models`）。3.2.0 的錯就是拿選單去回答目錄的問題。

### 按鈕會講實話

選著離線模型的時候，那顆按鈕現在寫的是**「離線語音」**，不是「雲端語音」。這不是用字問題：
在使用者正要按下去的那個控制項上，「雲端」正好否定了那個模型唯一重要的事——什麼都不會離開這台機器。
面板的確認框從 2.5.0 就會問這張表這個來源是不是本機的了；現在標籤也問同一個問題。
（換標籤之後寬度會重設，不然長的字會被畫進短的框裡、變成刪節號——不變條件 8z。）

## 3.2.0 - 2026-08-13

**日文離線模型、用自己的聲音當音色、還有一個試用版。**

### 日文離線模型

3.1.0 的離線語音只會中文和英文。現在多一個日文模型，兩個都在來源清單裡，各自下載、各自
存在自己的資料夾。**「下載模型」現在會問你要哪一個**——按在日文那一列就抓日文，不會花二十分鐘
抓錯一個。

**授權一樣是從檔案裡面看出來的，不是看網頁。** 那個模型的 ONNX metadata 裡面寫著
`license: MIT license`、`url: https://github.com/myshell-ai/MeloTTS`、`model_type: melo-vits`、
`language: Japanese`——跟中文那包同一個匯出工具寫的同一種證據。輸入張量也一模一樣，
所以傳輸那一段一個字都沒有改。（先抓檔尾 64 KB 就看得到，不用先下載 170 MB。）

**日文是用模型自己的詞典讀的，這是 8ac 唯一反過來的地方，而理由很明確：**
內建引擎讀得了假名，但**讀不了漢字**——一個漢字怎麼唸要看它在哪個詞裡，而這個產品沒有日文詞典
（不變條件 8h）。模型帶了一本：今日 是 `ky o`、日本 是 `n i q p o N`、私 是 `w a t a sh i`。
所以在日文這邊，詞典講得出引擎講不出的東西，而「兩個聲音要唸得一樣」這個理由在這裡不成立——
內建的聲音根本唸不出那句話。

日文那條路**不做數字轉換**（詞典自己有 1、10、100 這些條目），也**不吃 `[重|chong2]`
這種發音覆寫**（那是拼音，在日文裡不是任何字的讀音）。查不到的字照樣回報，不會默默吞掉。

### 用自己的聲音當音色

錄五個拉長的母音——ㄚ、ㄝ、一、ㄛ、ㄨ——各一兩秒，在「音色與動畫」頁按「我的聲音…」選進來，
引擎就用你嘴巴的形狀講話。**它是聲道，不是取樣**：聲調、長短、嘴型全部還是引擎算的。
取樣沒辦法照著中文聲調彎，這是當初否決取樣播放的理由，現在也還是。

**量的是 F1 和 F2**，就是決定「聽起來是哪個母音」的那兩個共振峰。**沒量的東西是推出來的，不是編的**：
F3 跟著 F2 的比例走（用手機錄的第三共振峰大多是雜訊，不可靠的數字比誠實推導的數字更糟），
頻寬跟著各自的共振峰走，而中文才有的那三個母音（zh/ch/sh 後面那個、ü、兒化）跟著已量到的平均走——
不然一張嘴裡會有兩個人。比例有上下限，錄到咳嗽應該產生奇怪的聲音，不是聽不見的聲音。

- **少錄一個母音沒關係**，那個母音就跟著你錄到的那幾個走。
- **量出來的東西是圖層的**，不是面板的：ABI 往後追加 11 個欄位（旗標 279、十個共振峰 280-289），
  3.2.0 之前存的專案讀到的是零，也就是「沒量過」，聲音一個取樣都不會變——`dsp_tests.cpp`
  兩種都算一次、逐取樣比對。
- **三種狀態要分清楚**：沒提到（保留圖層現有的）、空陣列（清掉）、有值（寫進去）。
  跟旋律那條規則同一個形狀（8t），弄混的話不是「清除」沒作用，就是匯入劇本會把錄好的聲音洗掉。
- 沒有足夠穩定聲音的檔案會**指名拒絕**：`frames` 是真的量到母音的影格數，個位數那是咳嗽或房間。

### 試用版

**同一個安裝包，同一批檔案，差別在引擎會在算出來的聲音上簽名**——每四秒一段 0.22 秒的兩音提示音，
音量壓在 −20 dB 左右。

為什麼是簽名而不是限制：試用要能判斷這個產品好不好，**三句話看不出二十句對白撐不撐得住**，
而時間限制對「一句話兩秒」的產品又沒有意義。所以試用版什麼都能做，然後在成品上簽名。

- **限制寫在編譯進去的引擎裡，不是面板裡。** 面板是純文字，寫在那裡的限制任何人用記事本就能刪掉。
- **簽名是絕對取樣位置的純函數**，所以延遲算圖跟一次算完仍然逐位元相同（不變條件 8d），
  而且它走在限幅器**前面**——加在後面會讓本來就大聲的句子破音，這一點是測試抓到的
  （「an extreme Volume clipped」）。
- **兩個方向都擋。** 打包腳本讀每個要出貨的二進位檔裡的記號：正式版帶著試用記號就拒絕
  （那會在使用者付錢買的聲音上簽名），試用版沒有記號、或混著兩種，也拒絕。
- **面板會講出來**：試用版啟動時狀態列直接寫「聲音每隔幾秒會有一小段標記聲」。
  不講的話，使用者會以為合成器壞了。

## 3.1.0 - 2026-08-13

**離線語音這次真的出貨了。** 下載一次模型，之後在自己的電腦上算——不連網、不用帳號、不用金鑰，
打的字一個都不會離開這台機器。**2.5.0 擋下來的兩個理由,一個解掉了,另一個講清楚。**

**版號跳過 3.0.0**：那個號碼在 CHANGELOG 裡已經被兩則記錄用掉了（一則是功能，一則是「不要發布」），
把同一個號碼拿來裝不一樣的東西只會讓以後讀的人對不上。3.0.0 從來沒有發布過。

### 授權：不是等 sherpa-onnx，是不用它了

`sherpa-onnx-c-api.dll` 靜態連結 espeak-ng（GPL v3+），沒有開關可以排除，而 **GPL 管的是散布出去的
檔案，不是哪幾行有跑到**。所以整包相依丟掉，直接用 **ONNX Runtime（MIT）** 跑同一個 MeloTTS 模型
（權重本身帶著一份逐字 MIT）。**現在這個產品裡沒有任何一個檔案跟 sherpa-onnx 有關**，而且
`npm test` 會擋：CMake 的建置行提到 sherpa 就失敗，打包腳本少了 `island_chatter_local.exe` 或
`onnxruntime.dll` 也失敗，`THIRD_PARTY_NOTICES.md` 還留著已經沒用到的授權聲明一樣失敗。

### 中文是**引擎**讀的，不是模型的詞典讀的

這是這一版最大的設計決定，而且省下的麻煩比想像的多。

sherpa 那條路是拿模型附的 195,828 條詞典去斷詞。問題是那本詞典**只有簡體詞**——查得到「银行」，
查不到「銀行」——所以繁體會退化成一個字一個字查，`銀行` 唸成 `yin2 xing2`。而且 `[重|chong2]`
這種發音覆寫、注音輸入、破音字表，模型那邊一概不知道。

現在中文交給引擎自己讀，就是內建聲音用的那一套：Unihan 表、詞組表、變調、注音、覆寫全部照舊。
**同一句話，內建聲音跟離線模型唸出來是一模一樣的讀音**，`銀行` 是 `hang2`，`[重|chong2]新開始`
真的會唸 chong2。詞典只剩兩個用途：英文單字（那是它的專長，ARPA 音素引擎沒有），
以及**推導音素表**。

**那張音素表是推導出來的，不是憑記憶寫的。** MeloTTS 拼音素的方式跟拼音不一樣，也跟直覺不一樣：
`ye` 是 `y E`、`yan` 是 `y En`、`ya` 是 `y a`（不是 `y ia`）、`weng` 是 `w eng`、`i` 在 zh/ch/sh/r
後面是 `ir` 但在 z/c/s 後面是 `i0`。這六個要是用手寫，六個都會錯。
所以 `native/tools/generate-melo-phonemes.js` 拿模型自己的 20,888 條單字詞典去對 Unihan 的讀音，
**讓兩萬多個字投票**：378 個音節有五票以上的多數，剩下 36 個罕見音節（kei、dia、biang）用同一批
資料重建——把音節拆成聲母和韻母，韻母從「同樣韻母而且有多數」的音節借。
**重建規則對 378 個可信音節的重現率是 378/378。** 沒有音素的只剩 4 個：m、n、ng、tunwa，
都是沒有詞會用到的成音節鼻音，而且測試釘住這份清單不准長大。

**數字要自己唸。** 丟掉 sherpa 也丟掉了那四個 OpenFST 正規化檔，所以 `2026年` 會變成只唸「年」——
那正是這個專案最怕的「安靜的錯」。現在 `melo::normalise_numbers()` 自己處理：四位數接「年」
逐字唸（二零二六），其他照數字唸（二十五、一百零五、十萬零五），千分位逗號吃掉，小數點唸「點」，
開頭是 0 或超過十二位的當編號逐字唸。**中括號裡面一個字都不動**——`[重|chong2]` 正規化成
`[重|chong二]` 就不是任何讀音了。

**唸不出來的字會講出來。** 假名、表情符號、那四個成音節鼻音，工具回報 `WARN`，面板跳一次提示
說「這些字沒唸出來」。錄音是照實產生的，分析器讀的是檔案不是劇本，所以這是唯一能發現差別的地方。

### 口音：講清楚，不遮

**這個聲音是中國口音的普通話女聲。** 可商用授權的中文模型只有這一個；台灣國語的離線 TTS 模型，
不管什麼授權都不存在（Common Voice zh-TW 是 CC0 但那是辨識資料、FormoSpeech CC BY-NC、
TAT 非商用而且是台語）。所以下載前的確認框、按鈕的說明、來源清單上的名字，**三個地方都直說**，
並且告訴使用者要台灣國語就用內建的聲音或雲端的 Azure zh-TW。

### 量出來的數字

- 一句話 **5.3 秒**：載入模型 3.1 s、推論 1.0 s、讀詞典 1.0 s。推論本身約 **4 倍即時**。
- 同樣的文字和設定**不會算第二次**：快取檔名跟雲端語音同一套 SHA-256，命中是 0.08 秒。
- 模型 **177 MB，三個檔案**（3.0.0 是七個）：四個 .fst 不用了，11 MB 的 jieba 詞典本來就沒抓。
- 執行期進安裝包：`island_chatter_local.exe` 加 `onnxruntime.dll` 16 MB。
- 讀 6.8 MB 詞典從 1.7 s 降到 0.1 s：先看行首那個位元組，不是 ASCII 就整行跳過——
  195,828 行裡有 190,000 行是這條路永遠不會問的簡體詞。

### 面板內試聽

按「試聽」直接聽，不用先套到圖層上。選著文字圖層就唸那一層的字（用面板現在這組聲音，
不是那層帶著的），沒選就唸文字框。**專案完全不會被動到**：不加圖層、不加特效、不加復原步驟、
專案檔旁邊不留檔案，所以不變條件 8g 那個 `app.purge()` 根本不會走到。
`npm test` 會擋住 `importFile`、`layers.add`、`beginUndoGroup` 出現在這條路上。

**聲音是我們自己的工具放的，而這是量出來才知道的。** 原本寫的是叫 PowerShell 放
（`Media.SoundPlayer` 一行），在 PowerShell 視窗裡跑得好好的——**在 After Effects 裡完全不動**：
每一條 PowerShell 命令都在大約 130 毫秒內回傳空字串，什麼都沒跑、什麼檔案都沒寫，
連 `powershell -NoProfile -Command "'ALIVE'"` 和寫完整路徑都一樣，而同一個 `system.callSystem()`
跑 `cmd /c echo` 卻正常回傳。`native/tests/ae-preview-probe.jsx` 就是那份量測，留在樹裡。

所以改成 `island_chatter_bake --play`：算完直接用 `PlaySound` 放，同步的，放完才回來。
`SND_NODEFAULT` 是必要的——少了它，Windows 會在放不出來的時候改放系統的「叮」，
那聽起來就像成功。而且**放之前要先把檔案關掉**：PlaySound 自己要開那個檔，
開不了還在寫入中的檔案，而那個失敗看起來跟「Windows 不支援這個 WAV」一模一樣。
順便，路徑因此回到十六進位那條路（不變條件 8e），使用者資料夾有中文也沒問題。
播完回報 `PLAYED`，**這個字會被檢查**，因為 callSystem 不回報結束碼，放不出聲音跟安靜地成功
長得一模一樣。

參數只有一份。`voiceArguments()` 現在是唯一組命令列的地方，圖層那條路先過 `settingsFromEffect()`
再進同一個函式——兩份的話，面板試聽的聲音跟圖層算出來的聲音會不一樣，而且畫面上不會有任何提示。

### Remove 會把長度還回去

「配合長度」會改寫圖層的出點，而在這之前**沒有任何地方記得原本多長**。所以 Remove 把特效、標記、
控制器、錄音都拿掉之後，圖層還停在引擎決定的長度上，關掉專案就再也回不去。

現在 `fitLayerToPlan()` 是唯一改出點的地方，第一次改之前把**原本的長度**記在圖層上
（`IC Original Length`，跟 `IC Rig Target` 同一套手法，不佔參數槽、不動已發布的 ABI）。
記的是**長度不是出點**：重新排版是移動 `startTime`，記絕對出點的話還原會把圖層放回舊位置，
而不是還原成舊長度——而這個差別只有在重新排版過之後才看得出來。
只記第一次，不然存的是上一次 Apply 留下的長度，那是引擎的不是使用者的。
沒設過「配合長度」的圖層沒有記錄，Remove 就不動它。

`npm test` 數面板裡 `.outPoint =` 出現幾次：**必須剛好三次**，多一個就表示有人繞過了那個函式，
而那條線的原始長度就沒被記下來，Remove 也就還不回去。

### 圖層記得自己是誰

以前一條線只有在指著共用控制器的時候才知道自己是哪個角色——不指了、或本來就走自己那組滑桿，
就沒有任何地方寫著。八個滑桿不是名字。

現在角色名寫在**特效的顯示名稱**上：`Island Chatter Voice · 咪咪`。不佔新的控制項（圖層的 comment
是使用者的、標記那邊已經有逐字標記、滑桿放不下字串），而 `findEffect()` 是先比對 matchName，
所以改過名字照樣找得到。順帶一提，這樣「特效控制」面板上就直接看得到這條線是誰。

有共用控制器就用它的名字（**指標消失的時候正是最想知道是誰在講話的時候**）；沒有的話退回面板上的
音色，而且**只有在滑桿還對得上那個角色的時候才寫**——名字對不上聲音的記錄比沒有記錄更糟，因為
會被相信。內建角色存的是英文那半：`"Mimi / 咪咪"` 存成當下顯示的那半，同一條線在不同介面語言下
就會讀成兩個不同的角色。

### 其他

- **CLAUDE.md 的「Current public release」進了版本同步檢查。** 它從 2.5.0 出貨那天就是舊的
  （還寫著 v2.4.0），因為它不是建置輸入、壞了也沒人會知道——而它正是維護者和 AI 最先讀的那個檔案。
- 21 個守則這一版全部**親手弄壞過一次**再確認它會擋。其中兩個一開始是假的：一個查 `PLAYED`
  這個字（可是它也出現在上面那行 PowerShell 命令裡），一個查那行指派（可是包在 `if` 裡面照樣
  查得到）。兩個都改成查機制——比較式的兩邊、還有那行指派所在的大括號深度。
- 面板多一列（「音色與動畫」頁的試聽），三頁維持三頁。

## 2.5.0 - 2026-08-13

**面板從四頁變三頁,雲端語音預設改成台灣國語。** 這一版沒有新的引擎,是版面和預設值。

- **「音色」和「動畫」併成一頁。** 兩頁各 208 和 260 px,講的都是「這個角色」而不是「這一句」,
  合起來 456 px 還在上限內。**分頁少一個,標題列也就窄一點**——那條列本來是全面板最寬的東西。
- **「匯入劇本」搬到「說話」頁**,因為匯入劇本就是「一次打很多行字」。最後一頁留給
  **已經做好的表演**:MIDI、錄音、雲端模型。
- **雲端語音的預設供應商改成 Azure。** 這是唯一真正重要的改動:Azure 的預設音色
  `zh-TW-HsiaoChenNeural` **是台灣國語**,而 OpenAI 和 ElevenLabs 的中文都偏中國腔。
  這個產品從頭到尾是繁體中文優先的——簡體那半是**算出來的**——那預設值就不該讓台灣使用者
  第一次按下去聽到中國腔。用 id 挑,不是把表重排,因為記住的選擇是索引,重排會讓已經
  選過的人被默默換掉。
- **語音來源多了一個「跑在這台機器上嗎」的欄位**,三家都是 false。面板從此**問這張表**,
  不再假設「語音來源一定要金鑰、要區域、要連網、要警告」。這四個假設每一個都有守則釘著。

**面板量出來 447 × 796 px。** 「說話」頁 568,離 570 上限只剩 2 px——那是「匯入劇本」搬過去
的代價,寫在 8z 裡了,而且拿回 64 px 的方法只有兩行。

**還修掉一個假的通過。** 宿主套件在「已經有專案開著」時會跳過,然後回報 `RESULT: PASS`——
檢查了零項卻說一切正常。三支套件現在檢查零項就不可能是 PASS,而且會存檔的兩支跑完會自己
關掉專案(不然下一支撞到存檔對話框,從外面看就像當掉)。

### 離線模型:做完了,但不出貨

原訂 3.0.0 是離線神經語音。**程式碼寫完、跑起來、宿主測試 21/21 全過,但它不會出現在這個
安裝包裡**,兩個各自獨立的原因:

**一、授權。** sherpa-onnx 發布的 `sherpa-onnx-c-api.dll` **靜態連結 espeak-ng**——檔案裡有
`CallPhonemizeEspeak`、`ESPEAK_DATA_PATH`、`Software\eSpeak NG`,共 100 個含 espeak 的字串——
而它的建置檔是 `if(SHERPA_ONNX_ENABLE_TTS)` 就無條件拉進去,**沒有開關可以排除**。
espeak-ng 是 GPL v3 or later,而 **GPL 管的是散布出去的檔案,不是哪幾行有跑到**。

這正是當初把 Piper 排除掉的同一個理由,而我第一次查錯了地方:**查的是「中文有沒有用到它」
(結果),不是「要出貨的檔案裡有沒有它」(機制)**。對那個 DLL 跑一次 `strings` 任何時候都能
問出答案。跟這個專案一路抓到的守則問題是同一個形狀。

**二、口音,而這個沒有解。** 唯一有可商用授權的中文模型是 MeloTTS,**中國普通話單一女聲**。
找過了:sherpa-onnx 的 642 個資產**零個**台灣模型,HuggingFace 標 `zh-TW` 的 12 個**全是語音
辨識或 LLM**。台灣國語的離線 TTS 模型,有可商用授權的,**不存在**。對一個繁體中文優先的產品
來說,那不是「先湊合用」,是不對的聲音。

授權那條有出路——**已經驗過了**:丟掉 sherpa-onnx,直接用 onnxruntime(MIT)跑同一個模型,
自己拿模型附的詞典做最長匹配斷詞。**實測 4.3 倍即時,比 sherpa 快 65%,分析器找到的音節數
一模一樣,而且不用 jieba、不用 espeak-ng。** 但那只解決授權,不解決口音,所以先停在這裡。

`island_chatter_local.exe` 留在原始碼樹裡,設了 `ISLAND_CHATTER_SHERPA_ROOT` 才會建。
等 sherpa-onnx 2.0.0 移除 espeak-ng、或等台灣語料的模型出現,它就在那裡等著。
面板上的「下載模型」按鈕在工具不存在時是**灰的**——按了才失敗讀起來像壞掉,灰的讀起來
像「還沒」,而後者是實話。

## 3.0.0 - 2026-08-13 — **不要發布這一版**

> **這一版的授權結論是錯的，錯在我身上。** 下面寫著「中文走詞典，完全不碰 espeak-ng，
> 所以那個問題根本不會發生」——**那句話對「執行路徑」是真的，對「散布的檔案」是假的。**
>
> 實際檢查了要出貨的 `sherpa-onnx-c-api.dll`：裡面**靜態連結著 espeak-ng**。
> 檔案裡有 `CallPhonemizeEspeak`、`ESPEAK_DATA_PATH`、`Software\eSpeak NG`、
> `Failed to initialize espeak-ng with data dir`，共 100 個含 espeak 的字串。
> 而 sherpa-onnx 1.13.5 的 `CMakeLists.txt` 是 `if(SHERPA_ONNX_ENABLE_TTS)` 就
> **無條件** `include(espeak-ng-for-piper)`，**沒有任何開關可以排除它**。
>
> espeak-ng 是 **GPL v3 or later**。GPL 管的是**散布出去的二進位檔**，不是「哪幾行有跑到」。
> 所以這個 build 不能用這個產品的授權方式散布——這正是當初把 Piper 排除掉的同一個理由，
> 只是我這次查錯了地方：**我查的是「中文有沒有用到它」（結果），不是「要出貨的檔案裡有沒有它」
> （機制）**。跟這個專案一路抓到的守則問題是同一個形狀。
>
> 出路有二：等 sherpa-onnx 2.0.0（他們的 issue #3731 就是為了授權相容要移除 espeak-ng），
> 或者不用 sherpa-onnx，直接拿 onnxruntime（MIT）跑那個 MeloTTS 模型、自己做詞典查表。
> 程式碼本身沒問題，不能出貨的是**這個相依**。

## 3.0.0 - 2026-08-13

**離線的真人聲音。** 下載一次模型，之後在你自己的電腦上算——不連網、不用帳號、不用金鑰，
打的字一個都不會離開這台機器。跟 2.4.0 的雲端語音並排在同一個下拉裡，選哪個就用哪個。

- **「語音來源」現在有四個**：OpenAI、ElevenLabs、Azure，加上本機模型。清單是**跟工具問來的**，
  不是寫在面板裡；而且**模型沒裝就一列都不會出現**——一個按下去才失敗的選項，
  讀起來像功能壞了，不像沒安裝。
- **選本機的時候，面板不會跟你要金鑰，確認框也換一句話。** 對本機模型講「文字會離開這台電腦」
  是假的，而且**會訓練使用者對唯一真正重要的那個警告視而不見**。所以那四個假設
  （要金鑰、要區域、要連網、要警告）現在全部是「問這張表」，不是寫死的。
- **產出的音檔一樣直接接音檔轉口型**，嘴巴照樣動。這件事一行新程式都沒寫——2.3.0 讓分析器
  印出跟引擎一模一樣的計畫格式，所以標記、控制器、嘴型切換、配合長度全部照舊。

**授權查清楚了才動手，而且結論推翻了原本的假設。** 原訂用 Piper——不能用：`rhasspy/piper`
**2025-10-06 已封存**，新家是 **GPL-3.0** 而且內嵌 espeak-ng；就算用封存的 MIT 版也一樣，
因為 `piper-phonemize` 連結的 espeak-ng 是 **GPL v3 or later**，散布出去的二進位檔照樣帶著它。
對一個賣編譯版、禁止再散布的產品來說，那不是風險，是擋路的。

改用 **sherpa-onnx（Apache-2.0）+ MeloTTS（模型包裡就是一份逐字 MIT，權重本身帶著）+
onnxruntime（MIT）**，而且**中文走詞典，完全不碰 espeak-ng**，所以那個問題根本不會發生。
這條鏈寫在 `local_cli.cpp` 開頭、來源對照表、和 `THIRD_PARTY_NOTICES.md` 裡——
以後有人想換引擎，那是唯一該先讀的東西。

**大小的取捨是量出來的，跟直覺相反。** fp32 是 170 MB、**2.6 倍即時**；int8 只有 53 MB，
但**慢四倍**（0.6 倍即時）。選了 fp32，所以模型不進 ZIP：**執行期 21 MB 進安裝包，
模型 178 MB 按一次「下載模型」抓一次。** ZIP 從 1 MB 變 7.9 MB，而不是變 180 MB——
你每個小修版都要手動上傳，那個差別是實際的負擔。

**下載器住在本機工具裡，不是雲端工具裡，理由跟直覺相反。** 雲端那支**拒絕轉址**，
因為它帶著金鑰而 WinHTTP 會把標頭重送到轉址指到的主機；但下載一定會被轉到 CDN，
所以它**需要**轉址——而唯一能安全跟隨轉址的，是一支**沒有東西可洩漏**的工具。
本機這支收下 `--key-file` 然後看都不看就丟掉，兩個方向都有守則釘著。

檔案是一個一個抓的，不是抓官方的 `.tar.bz2`，**所以產品裡不用夾一個 bzip2 解碼器**。
每個檔案的大小寫死在程式裡，因為「下載完了沒」必須是有答案的問題——截斷的 `model.onnx`
會載入成功，然後在離原因很遠的地方壞掉。實測：乾淨下載 177.5 MB / 31 秒；重跑 0.14 秒
什麼都不重抓；把一個檔案截斷，`--providers` 立刻回報「沒安裝」，修復只重抓那一個、0.5 秒。

**面板變三頁那次的代價，這一版就撞到了。** 「下載模型」原本放在金鑰旁邊——那一列日文
量到 **471 px**，超過 460 上限。守則第 8z 條說：太寬的列要拆，不是把字改短；而面板已經
796 px、上限 800，沒有空間開新的一列。所以它搬到「區域」那一列，那裡還有 200 px。

**還修掉一個假的通過。** 雲端那支宿主套件在「已經有專案開著」時會跳過，然後回報
**`RESULT: PASS`**——檢查了零項，卻說一切正常。任何拿 PASS 這個字去讀報告的東西都會被騙。
現在三支套件都一樣：檢查零項就不可能是 PASS。這跟這個專案一路抓到的守則問題是同一個形狀，
只是這次出現在報告本身。

- 面板多了「下載模型」一顆按鈕，分頁維持三頁，面板維持 447 × 796 px。
- 模型放在 `%LOCALAPPDATA%\Island Chatter\models\`，不在 Program Files——不需要系統管理員
  權限，移除程式也不會動到它（178 MB 不該被一次解除安裝默默丟掉）。
- 打包腳本現在少了 `island_chatter_local.exe` 或它的兩個 DLL 就拒絕出貨。因為本機工具只在
  有設 `ISLAND_CHATTER_SHERPA_ROOT` 時才建，這條同時擋掉「用沒設定的樹切版」。
- 日文模型延後：那是另一個 160 MB，而且 MeloTTS 日文的 g2p 有自己的相依要查。

## 2.4.0 - 2026-08-13

**可以用雲端大模型的聲音了，金鑰自己帶。** 選好句子、按「雲端語音」，OpenAI／ElevenLabs／Azure
把那一句唸出來，回傳的音檔直接接上 2.3.0 的音檔轉口型——嘴巴就動了。兩個功能在這裡合起來。

- **它是「按一次、產出一個音檔」，不是即時效果，而且不可能是。** 音訊回呼不能等網路：
  一次請求可能一秒，也可能三十秒，沒有人控制得了，而在音訊執行緒上等就是 After Effects
  當在那裡。所以走的是現有轉成音訊的那整條路——檔案寫在專案旁邊、匯入、把即時特效靜音——
  引擎的決定性（不變條件 8）一個字都沒有動。
- **文字會離開這台電腦，這件事直說。** 按下去之前會先跳出「這次要送 N 句、共 M 個字，
  送到哪一家」讓你確認，沒按就什麼都不會送。內建的聲音還是完全本機、不連網。
  Gumroad 商品頁上那句「不輸出音檔、聲音在 AE 裡即時算出來」也改寫了，
  現在講清楚哪一半在本機、哪一半要連網——而且 `npm test` 從此會核對商品頁的版本號，
  它從 2.1.0 就沒更新過，兩個版本都沒人發現。
- **同樣的文字和設定不會付第二次錢。** 檔名是「文字＋音色＋模型＋設定」的 SHA-256，
  算在工具那邊而不是面板那邊——面板自己算一份雜湊，就是第二份「決定要不要花錢」的程式碼，
  哪天有人加一個欄位，兩份就會不一致。快取命中的時候連金鑰都不會去讀。
- **金鑰不會出現在命令列上。** 工作管理員只要打開「命令列」那一欄，機器上任何人都看得到。
  所以金鑰寫進暫存檔、只傳路徑，工具讀完立刻刪掉那個檔（在連線之前，不是之後），
  面板事後再刪一次。工具**沒有** `--key` 這個選項，而且是明白拒絕、不是默默忽略——
  默默忽略的話，哪天有人把金鑰放回命令列也不會有任何東西壞掉。
- **供應商是一張表，加一家是加資料。** 主機、路徑、標頭、請求內容、回傳格式全部是字串，
  傳輸那一段完全不知道自己在跟誰講話。挑的都是會回傳未壓縮 PCM 或 WAV 的
  （OpenAI 的 wav、ElevenLabs 的 `pcm_24000`、Azure 的 `riff-24khz-16bit-mono-pcm`），
  所以產品裡不用夾一個 mp3 解碼器——那會是整個產品裡最大、最危險的一段「讀陌生人的檔案」。
  面板不知道任何一個網址：它跑 `--providers` 去問，因為第二份表一定會不一致，而且是無聲的。
- **改字之後不會自動重新去要。** 跟轉成音訊完全一樣：錄音靜音、內建的聲音回來、
  層名標上 `(stale)`，等你再按一次。敲一個鍵不應該花到錢。
  而嘴型會在同一個瞬間跟著回到引擎的計畫——`cloudVoiceLayer()` 看的是那層錄音有沒有被靜音，
  所以「聽到的」和「嘴巴在動的」不可能各講各的。

**錯誤訊息照抄供應商講的話。** 金鑰錯、超過速率、額度用完、連不上網路，是四件不一樣的事，
接下來要做的動作也完全不同——包成同一句「雲端語音失敗」正是不變條件 8k 記下來的那個虧。
六種真實的錯誤內容（OpenAI 的 `error.message`、ElevenLabs 的 `detail` 兩種寫法、
Azure 的純文字）都寫進測試，訊息必須原封不動傳到使用者眼前，中文和 em dash 都不能壞掉。

**金鑰不會跟著轉址跑。** WinHTTP 預設會跟隨 3xx，而且**會把原本的標頭重送到新的主機**——
在這裡那就是把一把能刷錢的金鑰交給轉址指到的任何地方，而且這端看起來一切正常。
這三家的端點都是直接 POST、不會轉址，所以轉址整個關掉；而且**關不成功就直接失敗**，
不會帶著一個其實不存在的保護繼續跑。回應也有上限（64 MB）：那個讀取迴圈沒有別的理由會停，
碰到一直送不停的端點就會一路讀到記憶體耗盡。TLS 明確要求 1.2 以上。

**測試抓到一個真的洞。** 標頭注入的檢查本來是在展開之後、切成一行一行時才查有沒有換行——
但金鑰裡的 `\r\n` 展開之後正好把自己切成兩個看起來完全正常的標頭，什麼都查不出來。
現在是在展開**之前**檢查每一個值。這跟 2.2.0 那次是同一個形狀：查的是結果，不是機制。
（唯一豁免的是台詞本身，它有跳脫，而且台詞裡本來就會有換行。）

SHA-256 是自己寫的（執行環境不帶相依），所以拿 FIPS 180-4 自己的測試向量釘住，
包括 55、56、64 位元組那幾個補位邊界和一百萬個 `a`——憑記憶寫出來的雜湊，
價值完全等於用來對照的向量。

**順手修掉一個從 1.6.0 就在的當機。** 對同一層按第二次「轉成音訊」會直接跳
`ReferenceError: Object is invalid`。原因是清掉舊錄音的那個迴圈：它把那一層移除之後，
**接下來每一圈還在跟那個已經不存在的物件要 index**，而下面一定還有東西可以繞（文字圖層自己就在）。
第一次轉檔沒有舊錄音可以清，所以永遠不會踩到——這就是它躲了這麼久的原因。
現在 index 在迴圈開始前讀一次就好。雲端語音每次重新產生都會走這條路，所以這一版非修不可。

- 面板多了三列在「匯入」頁（雲端語音／供應商／金鑰、音色代號與模型、區域與狀態）。
  **分頁還是四個**：第五個分頁的標題列會到 507 px，超過 460 的上限，
  而且每個分頁光內距就約 97 px，縮短標題救不回來——2.3.0 實際撞到過。
- 金鑰存在這台電腦的 After Effects 偏好設定裡，是明碼。ExtendScript 沒有金鑰保管的地方，
  而加密金鑰本身也得放在同一個檔案裡的話，那只是演給人看的。輸入時是隱藏的，
  同一個視窗裡就有「清除」。
- 音色代號、模型、區域**分供應商記住**，換過去再換回來不會不見。
- 每一句上限 2000 個字。供應商自己也會擋，但這一擋是免費的，被擋的那一次不是。

## 2.3.0 - 2026-08-12

**嘴巴可以用錄音來驅動了。** 選一個音訊圖層、選好角色、按「音檔轉口型」。

- **真人配音、自己錄的聲音、別的地方來的檔案都可以。** 引擎會讀那個檔案、找出裡面的音節，
  然後寫出**跟講話的句子一模一樣的控制器**——所以嘴型切換、逐字標記、頭部晃動全部照舊，
  一行都沒改。錄音本身不會被動到，也不會產生新的音檔。
- **這是靠格式完全不變做到的。** 分析器輸出的東西跟引擎的 `--plan` 一個位元組都不差，
  所以面板那邊解析、標記、控制器、配合長度整條下游**完全不用知道**這次是文字還是錄音。
- **靜音會讓嘴巴閉起來**，走的是 1.10.0 那條「有停頓才閉嘴」的規則。停頓不用另外處理。
- **圖層剪過的話只用剪過的那一段。** 有時間伸縮的圖層會直接拒絕——這裡沒有任何東西知道
  伸縮把每個音節移動了多少，猜錯的話整段嘴型都會對不上，講清楚比默默做錯好。
- **兩個控制項。** 靈敏度決定音量的高峰要多明顯才算一個音節（嘴巴動太頻繁就調高，
  漏字就調低）；「判斷母音」關掉的話每個音節都用張開的嘴型，那就是這個產品名字由來的碎嘴效果。
- 錄音沒有逐字顯示可用（沒有文字可以顯示）。重建會重新讀一次檔案，
  所以圖層移動或重新剪過之後按一下重建就對回去了。
- 面板多了「音檔」分頁，高度沒有變。

**準確度是量出來的，不是感覺的。** 引擎有辦法同時給出一句話的聲音**和**那句話正確的音節表，
所以分析器可以直接對分：中文 8/8、英文 6/6、日文 5/5 個音節全部找到，時間平均差 7 到 14
毫秒；母音則有 **68%（11/16）**跟引擎自己知道的答案一致。母音本來就是猜的——是從聲音的形狀
判斷，不是知道在講什麼——底下有音樂的時候會明顯更差。這些數字都寫進測試裡，退步會被擋下來。

**讀檔案這件事是照 `midi.cpp` 的規矩寫的**，因為這是整個產品裡唯一一個「陌生人挑的檔案」。
每一個長度都當成宣稱而不是事實，實際弄壞過的情況包括：空檔案、砍掉一半的檔頭、
宣稱自己有四 GB 但只有十個位元組的資料塊、零聲道、取樣率零、每個取樣七個位元、
只有空塊的檔案。全部回訊息，沒有一個會讓 AE 當掉。壓縮格式和 MP3／M4A／Ogg／FLAC
會**指名說出它是什麼**並告訴你要轉成什麼——「這不是 WAV」對一個剛挑了 MP3 的人毫無幫助。
收 WAV 和 AIFF，AIFF 是因為 After Effects 自己算圖輸出的就是 AIFF。

**順手修掉一個一直在的地雷。** 面板以前是拿寫死的 48000 去除計畫裡的取樣數，不是讀計畫
自己寫的 `RATE`。講話的句子永遠一樣所以看不出來，但分析器回答的是一個**它沒得選取樣率**
的檔案：一份寫著 44100 的計畫被 48000 除，每個嘴型都會早 9%，而且愈長偏愈多，
畫面上完全看不出原因。現在照計畫自己說的算。

## 2.2.0 - 2026-08-12

**面板從 1354 px 縮到 732 px。** 設定分成四頁，套用鍵永遠看得到。

- **以前被切掉的，正好是最常按的那幾顆。** 面板是 40 列擠成一直行，量出來要 1354 px 高，
  而 After Effects 的腳本面板**不會長出捲軸，只會直接切掉**。1080p 螢幕的停靠區大概 900 px，
  所以看不到的是最下面那一段——**套用、重新同步、重新排列、轉成音訊、移除，還有狀態列**。
- **設定分頁，動作不分頁。** 四頁：**說話**（文字、讀音、聲線情緒體型、六個主要滑桿、節拍）、
  **音色**（共鳴、發聲源、顫音、種子、角色預設）、**動畫**（標記、配合長度、動畫控制、逐字顯示、
  角色綁定、嘴型切換、離開與平滑）、**劇本與唱歌**（匯入劇本、間隔、MIDI、移調、唱名調）。
  套用、重新同步、重新排列、轉成音訊、移除和狀態列**留在分頁外面**，不管你在哪一頁都按得到。
- **聲線、情緒、體型從三列變一列。** 三個下拉本來各佔一整列，卻沒有任何一個有標籤——直排橫排
  一樣要靠位置認，那就別花那 48 px。
- **會記得你上次停在哪一頁。** 舊版存下來的偏好少這一項，開起來就停在「說話」，也就是面板
  一直以來開機的那一頁。
- **聲音、參數、專案完全沒動。** 這一版只有版面：沒有改任何一個效果參數，沒有改任何一個音，
  舊專案打開來一模一樣。

**高度以前根本沒有人量過。** 寬度從 2.0.0 就有 460 px 的上限，高度一條規則都沒有——這就是它
一列一列長到 1354 px 都沒被發現的原因。現在面板不得超過 800 px、任何一頁不得超過 570 px，
數字是從「1080p 停靠區大概 900 px」回推的。目前最高的是「說話」頁 504 px。

**而寬度那條守則差一點就變成瞎子。** 它是走 `面板的每一個小孩` 一層而已；分頁之後真正的列
沉到兩層以下，它會去量四個分頁容器、量不到任何一列，然後**回報一切正常**。跟 2.0.0 那次
是同一個形狀：測試還在跑，也還在說沒問題。現在它會遞迴走進每一頁。

**翻譯檢查也缺了半條。** 舊的只問「表裡的翻譯，面板還在用嗎」，所以**一個從來沒有翻譯的標籤
永遠不會被問到**——把新分頁的日文拿掉，測試照樣通過。補上反方向之後抓到一個真的漏網之魚：
1.0.2 時代那個沒有名字的角色叫「已儲存」，**從那時候到現在都沒有日文**。

六種寫壞的方式都實際弄壞過一次確認會擋：分頁標題沒有日文、新標籤沒有翻譯、「已儲存」再次
掉出翻譯表、掃描本身壞掉、**分頁裡面**塞一列六個按鈕（584 px）、「說話」頁多三列（600 px）。
順帶量到一件事：單獨一個超長標籤是撐不爆寬度的，ScriptUI 會把它夾住；真正會撐爆的一直都是
一列塞太多控制項，跟 1.7.0 那列十一個控制項的唱歌列一樣。

## 2.1.0 - 2026-08-12

**面板多了简体中文，四種語言。** 語言選單現在是 繁體中文／简体中文／English／日本語。

- **不是只換字，連用詞也換。** 逐字轉換會做出「用簡體字寫的台灣中文」——「算圖佇列」變成
  「算图伫列」，中國沒人這樣說。所以先換詞再換字：**專案→项目、資料夾→文件夹、影格→帧、
  關鍵影格→关键帧、滑桿→滑块、算圖→渲染、佇列→队列、音訊→音频、匯入→导入、套用→应用、
  儲存→保存、設定→设置、預設→默认、選取→选中、介面→界面、字元→字符、嘴型→口型、
  建立→创建、空物件→空对象、文字圖層→文本图层**，一共 27 條。
- **簡體是「算出來的」，不是再寫一份。** 163 則訊息、29 個提示如果手寫兩份中文，第一次改字
  就會不一致，而且以後每加一句話都要記得寫兩遍。現在從繁體那一份轉出來，**新加的訊息自動就
  有簡體**。
- **漏字會被測試抓到。** 面板用到的 464 個漢字每一個都要被分類過——不是在轉換表裡，就是在
  「兩邊寫法相同」的清單裡。寫了新訊息用到沒見過的字，`npm test` 就會失敗並把那個字印出來。
  否則簡體使用者會看到一句混著繁體字的話，而畫面上看起來不夠怪，不會有人發現。
- **聲音、參數、版面完全沒動。** 引擎本來就讀得懂簡體字（音樂／音乐 兩種寫法都在讀音表裡），
  這一版只有介面。最寬的一列還是 421 px——簡體不會比繁體寬。

八種寫壞的方式都實際弄壞過一次確認會擋，包括「轉換函式從 T() 拿掉」「詞表順序排錯」
「語言選單少一個而語言代碼還在」——最後那個以前不會失敗，現在會。

## 2.0.0 - 2026-08-11

**面板真的會講三種語言了。** 1.2.0 就有語言選單，但翻的只有「按鈕上的字」。面板**開口說的
每一句話**——狀態列、警告視窗、提示氣泡——從頭到尾都沒翻過。

- **狀態列以前同時講兩種語言。** 每一則訊息都是寫死的 `英文 / 中文`，所以不管選哪個語言，
  你看到的都是「已排列 3 層 @ 1 拍」前面掛著英文。選日文更慘：**一個日文字都沒有。**
  這次 40 則狀態訊息、25 個警告視窗、確認框、命名視窗、選檔視窗，全部進翻譯層。
- **數字卡在中文句子中間的那些，是真的翻不了。** 「已唱出 3 句」是「已唱出 」+ 3 + " 句"
  接出來的——中文夾在數字兩邊，翻譯沒有地方可以放。所以訊息改成帶 `{0}` 的樣板，數字自己
  找位置：英文是 `Sung 3 line(s)`，日文是 `3 行を歌わせました`。
- **提示氣泡（滑鼠停著會跳出來的說明）以前是中文的。** 29 個氣泡，中文寫得很完整、英文只有
  一句、日文沒有。現在三種語言各一份完整的說明——英文全部補到跟中文一樣的份量，日文從頭寫。
  這是這一版最大的一塊：光是說明文字就多了三倍。
- **切換語言時提示氣泡也跟著換。** 以前氣泡不在翻譯的清單裡，切了語言也不會動。
- **零星的中文碎片也清掉了。** 節拍讀數的「秒／字」「角色補償」「超出範圍」、間隔讀數的
  「無格線」「十六分」、MIDI 讀數的「軌」「句」，這些以前不管選什麼語言都是中文。

**測試補上了反方向的檢查。** 舊的檢查只問「翻譯表裡的字，面板還在用嗎」——所以**新加的訊息
根本不會出現在表裡，也就永遠不會被抓到**。這正是為什麼漏了兩年。現在反過來也檢查：任何一則
訊息沒有日文、或者又用接字串的方式寫出來、或者中文碎片跑進讀數，`npm test` 就會失敗。九種
寫錯的方式都實際做壞過一次，確認測試真的會擋下來。

另外加了一支**在 After Effects 裡跑**的檢查（`ae-language-verify.jsx`）：真的把面板開起來、
真的切三次語言，然後從畫面上的控制項讀回文字和提示。前面那些檢查是在 Node 裡跑的，而 Node
不是 ExtendScript——這一版全部的內容都是介面文字，那就得在真正會執行它的引擎上驗一次。
實測 163 條訊息、29 個提示、102 個控制項全數通過。

## 版面：換了語言字會被切掉，還有選單會跑掉

翻譯做完之後才發現的兩件事，都跟文字長度有關，也都一起修掉了。

- **換語言之後每個字都被切掉，變成「中央ぞ…」「台本を読み…」。** 原因不是面板太窄——旁邊
  明明還有空位。ScriptUI 幫每個控制項量一次寬度就記住了，後來改掉上面的字，它還是用舊的
  框去畫，長出來的部分就被 After Effects 畫成刪節號。**每個標籤都還穿著中文標籤的衣服。**
  現在換語言時會叫它重新量。**重開面板本來就是對的**，所以這個問題只在「開著面板切語言」
  時看得到。
- **語言選單會跑掉，而且可能跑到面板外面。** 它本來靠右對齊，位置是從「最寬的那一列」算
  出來的，所以每換一次語言就移動一次；面板比那一列窄的時候就整個離開畫面——**切成日文之後
  就找不到切回去的地方了。** 改成靠左，位置固定。
- **有四列本來就太寬，跟翻譯無關。** 唱歌那一列擠了 11 個控制項，光是**中文就要 762 px**，
  日文 817 px，而文字框要求的面板寬度是 414 px。它從 1.7.0 就是全面板最寬的一列，只是日文
  多要 55 px 才讓它爆出來。把唱歌拆成三列（選檔／設定／執行），動畫控制、角色、匯入各拆成
  兩列之後，**最寬的一列從 817 px 降到 421 px**，三種語言都一樣。
- 順帶查出來的：讀數欄位建立時是空的，而**空的 statictext 設寬度沒有作用**——那幾個
  `preferredSize.width` 從來沒生效過。它們會自己照內容伸縮，所以行為是對的，但量的時候
  要先填字，不然會漏算一百多 px。

`ae-language-verify.jsx` 現在會逐列量寬度，超過 460 px 就失敗，語言選單被改成靠右也會失敗。
兩個都實際弄壞過一次確認會擋——把唱歌那一列併回去，它回報「zh 572 px、ja 595 px」。

**聲音一個取樣都沒變。** 這一版沒有動到引擎，效果器參數還是 279 個，舊專案打開來完全一樣。
面板語言本來就不影響唸出來的內容：假名唸日文、漢字唸中文，跟面板顯示什麼無關。

- 安裝時會順手清掉 1.0.10 以前留下的 `IslandChatterMandarinReadings.jsxinc`（484 KB，
  面板從 1.0.10 起就不再需要它了）。移除程式本來就會刪，但升級不會，所以它一直躺在那裡。

## 1.11.0 - 2026-08-10

- **新的控制器 `IC Accent`。** 每個字開始的瞬間彈到 **100**，然後在這個字的長度內落到
  **50**，曲線是**先快後慢**——像被敲一下之後慢慢安定下來。休息時停在 50，下一個字直接彈回
  100，不會慢慢爬上去。
- **它是唯一有曲線的一條。** 其他五條都是 hold 關鍵影格（rig 刻意不做即時運算），而 Accent
  的價值就在形狀：如果只是在 100 和 50 之間跳，那就只是換了數字的 `IC Volume`。所以這一條
  兩端的插值是分開設的：起點那一格「跳進去、曲線出來」，終點那一格「曲線進來、跳出去」。
- 唱歌的長音也一樣，在整個音符的長度內落下去。
- 舊專案按 Apply 或 Rebuild 就會多出這根滑桿，預設值 50。既有的五根一個關鍵影格都沒動。

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
