# Island Chatter AE

讓 After Effects 的文字圖層直接發出原創的遊戲式角色語音，主要針對繁體／簡體中文設計。不需要先輸出 WAV 就能直接預覽與算圖；
需要交檔或想省效能時，再按一次 Bake 轉成音訊檔即可。

> 這是獨立開發的程序式語音合成器，沒有使用、擷取或附帶任天堂／《動物森友會》的聲音與素材。

## 功能

- 特效直接掛在文字圖層，預覽與輸出都由 AE 即時計算
- 44,355 個 Unihan 漢字讀音，支援繁體與簡體中文
- 中文聲母、韻母、送氣音、捲舌音、鼻尾、雙母音與四聲／輕聲
- 三聲變調、「一／不」變調、常用輕聲字與常見多音詞
- 拼音、注音與行內讀音覆寫，例如 `[重|chong2]新`
- 日文假名直接發音：拗音、促音、撥音、長音、外來語小字都處理，不需要字典
- 面板介面可切換繁體中文／English／日本語
- 8 種角色聲線、7 種情緒、4 種角色體型
- 共鳴滑桿獨立於音高，可做出同音高但體型完全不同的角色
- 6 種發聲源：人聲、簧片、電子、金屬、破碎、低吼
- 顫音深淺與速率可分開調整
- 音高（0.10–4.00）、速度（0.10–10.00）、音量（0–200%）、聲母強度（0–6.00）、清晰度、可愛度與固定隨機種子
- 配合 BPM 節拍，可精準落在拍點上
- 一鍵轉成音訊（Bake），播放零運算
- 多選文字圖層批次套用
- 可選擇自動配合圖層長度、建立 `IC:` 逐字時間標記
- 可建立 `IC Mouth`、`IC Volume`、`IC Pitch`、`IC Head Bounce`、`IC Blink` 動畫控制器
- 可選擇建立不破壞 Source Text 的逐字顯示動畫，並可維持置中、平滑滑動
- 不含音訊資產；相同設定可重現相同結果

## 系統需求

- Windows 10／11 x64
- Adobe After Effects 2025 或 2026（目前實機驗證：After Effects 2026）
- 安裝時需要可寫入 After Effects 安裝資料夾的權限

## 安裝

安裝包在 Gumroad 販售：**[購買 Island Chatter AE](https://xupster.gumroad.com/l/IslandChatterAE)**

原始碼是公開的，你也可以自行編譯（見下方「從原始碼測試與建置」）。

### 安裝步驟

1. 解壓縮 `Island-Chatter-AE-*-Windows-x64.zip`。
2. 關閉 After Effects。
3. **雙擊 `Install.bat`**，出現使用者帳戶控制的視窗時按「是」。
4. 重新開啟 After Effects，選擇 `Window > IslandChatterNativePanel.jsx`。

要移除就雙擊 `Uninstall.bat`。

解壓縮出來只有四樣東西，要動的只有第一個：

```
Island-Chatter-AE-1.0.10-Windows-x64/
  Install.bat        ← 雙擊這個
  Uninstall.bat
  README.txt
  LICENSE
  resources/         ← 外掛本體與安裝腳本，不用手動去動它
```

`Install.bat` 只是替你開好權限並執行 `resources\Install-IslandChatter.ps1`，兩個都是純文字檔，
可以先打開看內容。想自己下指令也可以：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\resources\Install-IslandChatter.ps1
   ```

安裝器預設安裝到最新版本的 AE；加上 `-AllVersions` 可安裝到所有偵測到的版本。也可以用 `-AfterEffectsRoot "...\Support Files"` 指定位置。

### 手動安裝

四個檔案都在 `resources\` 裡：

- 把 `IslandChatterNative.aex` 與 `island_chatter_bake.exe` 放到 `Support Files\Plug-ins\Island Chatter\`
- 把 `IslandChatterNativePanel.jsx` 放到 `Support Files\Scripts\ScriptUI Panels\`
- 重新啟動 After Effects

## 使用方式

1. 建立合成與文字圖層，輸入中文。
2. 選取一個或多個文字圖層。
3. 在 Island Chatter 面板選擇角色、情緒與語音參數。
4. 視需要勾選 Markers、Fit Duration、Rig 或 Type-On。
5. 按下 **Apply to selected text layers**。
6. 修改 Source Text 後再按一次 Apply，即可同步文字、時間與動畫資料。
7. 不想要了就按 **Remove／移除**，會一次清掉特效、Tone、動畫控制器、`IC:` 標記與逐字動畫器。

> 音高、速度、聲母這幾個參數請「設定一次」就好。After Effects 對音訊特效是一個區塊給一組參數值，
> 對它們下 keyframe 會讓整段語音在每個區塊重新合成，速度動畫還會讓每個字的位置跑掉，接縫處可能聽得到跳動。
> 音量不受這個限制 —— 它是合成後才套用的增益，隨時調整都不需要重新運算。

## 配合節拍（BPM）

勾選 **Tempo／節拍**，填入 BPM 與「每拍幾個字」，語速會自動換算（`速度 = BPM × 每拍字數 ÷ 300`）。
手動拖動語速滑桿會自動關掉節拍模式。

勾選節拍模式時會同時開啟特效的 **Tempo Lock／節拍鎖定**：關掉每個字長度的隨機微調，並把標點停頓
對齊到整數個字的長度，讓每個字精準落在拍點上。實測 60–174 BPM、每拍 1／2／4 字，誤差都在
0.03 毫秒以內。

## 轉成音訊（Bake）

按 **Bake／轉成音訊**，語音會寫成 WAV 放進專案檔旁邊的 `Island Chatter Audio` 資料夾，並自動匯入成
音訊圖層放在原圖層下方，同時把即時特效靜音以免重複發聲。

轉檔後播放完全不需要運算，時間軸上看得到波形，專案給沒安裝外掛的人也聽得到。這一步不經過 After Effects
的算圖佇列，也不會動到工作區或其他圖層，通常幾百毫秒就完成。專案需要先存檔，音訊才知道要放在哪裡。

面板會在同一文字圖層加入零音量的 AE 內建 Tone 作為音訊來源，再由 `Island Chatter Native` 取代輸出樣本。這是為了避開 AE 26 對第三方文字圖層音訊合成的宿主崩潰路徑；不會建立載體圖層或外部 WAV。

## 日文

假名直接就是發音，不需要字典，也不會多裝任何東西。拗音（きゃ）、促音（っ）、撥音（ん）、長音（ー）
以及外來語的小字（ファ、ヴァ）都處理好了，片假名跟平假名共用同一份對照。日文的一個拍（mora）
跟中文一個字等長，所以節拍鎖定在日文一樣落得準。

**漢字不會自己猜讀音。** 同一個漢字在不同詞裡念法不同，那需要字典跟上下文判斷。沒有標注的漢字
會退回中文讀音，面板會在狀態列告訴你哪一層是這種情況，不會安靜地念錯。要標就用跟中文一樣的語法：

```
[今日|きょう]はいい[天気|てんき]
```

は 跟 へ 當助詞時念 wa 跟 e，但那要看文法：こんにちは 是 wa，おはよう 是 ha，光看前後字分不出來。
所以只有四個完全沒有歧義的固定招呼語有特別處理，其餘請自己標：`きょう[は|わ]いいてんき`。

## 中文讀音覆寫

讀音欄位可填：

- 數字聲調拼音：`ni3 hao3 ma5`
- 以空格分隔的注音：`ㄋㄧˇ ㄏㄠˇ ㄇㄚ˙`
- 行內覆寫：`[重|chong2]新開始`

批次套用多個文字圖層時，為避免同一個覆寫誤套到不同句子，面板會使用各圖層自己的 Source Text。

## 從原始碼測試與建置

```powershell
npm test
cmake -S native -B native/build
cmake --build native/build --config Release
ctest --test-dir native/build -C Release --output-on-failure
```

建置 `.aex` 需要 Adobe After Effects SDK；SDK 不隨本專案散布。詳細指令請看 [`native/README.md`](native/README.md)。

若已完成 `.aex` 建置，可產生 Windows 發行包：

```powershell
npm run package:windows
```

## 維護與程式碼審查

要接手維護或使用 Claude Code 等工具檢視專案，請先閱讀 [`CLAUDE.md`](CLAUDE.md)。其中整理了架構、AE 相容性設計、不可破壞的參數 ABI、測試順序與優先審查項目。

## 開源與商標

本專案是 **source-available**，不是 OSI 定義的開源：原始碼公開，你可以閱讀、自行編譯、
自己使用（包含商業接案），但**不能把編譯出來的檔案轉發給別人**。完整條款見 [LICENSE](LICENSE)。

想直接安裝不想自己編譯的話，請到 [Gumroad](https://xupster.gumroad.com/l/IslandChatterAE) 購買官方安裝包。

Unicode 讀音資料維持它自己的授權，請見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

After Effects 是 Adobe 的商標；Nintendo 與 Animal Crossing 是其各自權利人的商標。本專案與上述公司沒有關聯或背書關係。

## English

Island Chatter AE is an original, procedural Mandarin character-voice effect for Adobe After Effects. It runs directly on text layers, needs no audio files to preview or render, and can bake to WAV on demand. It supports Traditional and Simplified Chinese readings, pronunciation overrides, character presets, timing markers, rig controllers, and Type-On animation. The Windows installer is sold at https://xupster.gumroad.com/l/IslandChatterAE; the source here can be built yourself.
