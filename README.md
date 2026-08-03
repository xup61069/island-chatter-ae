# Island Chatter AE

讓 After Effects 的文字圖層直接發出原創的遊戲式角色語音，主要針對繁體／簡體中文設計。不需要先輸出 WAV，也不會在專案旁產生一堆音訊檔。

> 這是獨立開發的程序式語音合成器，沒有使用、擷取或附帶任天堂／《動物森友會》的聲音與素材。

## 功能

- 特效直接掛在文字圖層，預覽與輸出都由 AE 即時計算
- 44,355 個 Unihan 漢字讀音，支援繁體與簡體中文
- 中文聲母、韻母、送氣音、捲舌音、鼻尾、雙母音與四聲／輕聲
- 三聲變調、「一／不」變調、常用輕聲字與常見多音詞
- 拼音、注音與行內讀音覆寫，例如 `[重|chong2]新`
- 8 種角色聲線、7 種情緒、4 種角色體型
- 音高、速度、音量、聲母強度、清晰度、可愛度與固定隨機種子
- 多選文字圖層批次套用
- 可選擇自動配合圖層長度、建立 `IC:` 逐字時間標記
- 可建立 `IC Mouth`、`IC Volume`、`IC Pitch`、`IC Head Bounce`、`IC Blink` 動畫控制器
- 可選擇建立不破壞 Source Text 的逐字顯示動畫
- 不含音訊資產；相同設定可重現相同結果

## 系統需求

- Windows 10／11 x64
- Adobe After Effects 2025 或 2026（目前實機驗證：After Effects 2026）
- 安裝時需要可寫入 After Effects 安裝資料夾的權限

## 安裝

### Release 安裝包

1. 從 GitHub Releases 下載 `Island-Chatter-AE-1.0.0-Windows-x64.zip` 並解壓縮。
2. 關閉 After Effects。
3. 以 PowerShell 執行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\installer\Install-IslandChatter.ps1
   ```

4. 重新開啟 After Effects，選擇 `Window > IslandChatterNativePanel.jsx`。

安裝器預設安裝到最新版本的 AE；加上 `-AllVersions` 可安裝到所有偵測到的版本。也可以用 `-AfterEffectsRoot "...\Support Files"` 指定位置。

### 手動安裝

- 把 `IslandChatterNative.aex` 放到 `Support Files\Plug-ins\Island Chatter\`
- 把 `IslandChatterNativePanel.jsx` 與 `IslandChatterMandarinReadings.jsxinc` 放到 `Support Files\Scripts\ScriptUI Panels\`
- 重新啟動 After Effects

## 使用方式

1. 建立合成與文字圖層，輸入中文。
2. 選取一個或多個文字圖層。
3. 在 Island Chatter 面板選擇角色、情緒與語音參數。
4. 視需要勾選 Markers、Fit Duration、Rig 或 Type-On。
5. 按下 **Apply to selected text layers**。
6. 修改 Source Text 後再按一次 Apply，即可同步文字、時間與動畫資料。

面板會在同一文字圖層加入零音量的 AE 內建 Tone 作為音訊來源，再由 `Island Chatter Native` 取代輸出樣本。這是為了避開 AE 26 對第三方文字圖層音訊合成的宿主崩潰路徑；不會建立載體圖層或外部 WAV。

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

## 開源與商標

程式碼使用 [MIT License](LICENSE)。Unicode 讀音資料的授權請見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

After Effects 是 Adobe 的商標；Nintendo 與 Animal Crossing 是其各自權利人的商標。本專案與上述公司沒有關聯或背書關係。

## English

Island Chatter AE is an original, procedural Mandarin character-voice effect for Adobe After Effects. It runs directly on text layers, creates no audio files, supports Traditional and Simplified Chinese readings, pronunciation overrides, character presets, timing markers, rig controllers, and Type-On animation. See the installation section above or the release archive for the Windows installer.
