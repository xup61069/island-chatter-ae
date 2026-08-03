# Island Chatter for After Effects

在 After Effects 裡把文字變成原創的「島民式碎語」WAV。完全離線、無外部相依套件，支援繁體中文、英文、日文等 Unicode 文字。

> 本專案的聲音由程式即時合成，不含、也不擷取任何遊戲音效、角色或其他專有素材。它不是 Nintendo 或《動物森友會》的官方產品，也未受其認可。

## 功能

- 直接執行單一 `IslandChatter.jsx`
- 讀取 AE 目前選取的文字圖層
- 4 種原創聲線，以及音高、速度、音量控制
- 輸出標準 44.1 kHz / 16-bit / mono WAV
- 自動匯入 Project，並可放到合成的目前時間
- 不上傳文字或音訊，沒有網路依賴
- 中英雙語面板，可停駐在 AE 介面

## 快速使用

1. 下載 [`IslandChatter.jsx`](./IslandChatter.jsx)。
2. 在 After Effects 開啟：
   - Windows：`編輯 > 偏好設定 > 指令碼與運算式`
   - macOS：`After Effects > 設定 > 指令碼與運算式`
3. 啟用「允許指令碼寫入檔案及存取網路」。本腳本只需要其中的本機寫檔權限。
4. 選擇 `檔案 > 指令碼 > 執行指令碼檔案…`，開啟 `IslandChatter.jsx`。
5. 輸入文字或選取文字圖層，調整聲線後按「產生碎語」。

## 安裝成可停駐面板

將 `IslandChatter.jsx` 複製到 After Effects 的 `Scripts/ScriptUI Panels` 資料夾，重新啟動 AE，然後從 `視窗 > IslandChatter.jsx` 開啟。

常見位置：

- Windows：`C:\Program Files\Adobe\Adobe After Effects <版本>\Support Files\Scripts\ScriptUI Panels\`
- macOS：`/Applications/Adobe After Effects <版本>/Scripts/ScriptUI Panels/`

## 聲音設計

Island Chatter 會把每個非空白字元映射成一小段帶有泛音、共振峰、滑音、顫音與少量氣聲的合成音。相同文字和設定會得到一致的節奏與音色；標點符號會產生自然停頓。所有波形都在本機由數學函式生成。

## 開發與檢查

需要 Node.js 18 或更新版本：

```bash
npm test
```

自動檢查會驗證 ExtendScript 語法、WAV 寫入必要結構，以及專案內沒有二進位音訊素材。實際 AE 匯入仍建議在支援 ExtendScript 的 After Effects 版本中做一次冒煙測試。

## 參與貢獻

歡迎開 Issue 或 Pull Request。請避免提交來自遊戲或其他來源、且你無權再散布的音訊與視覺素材。

## 授權與商標

程式碼以 [MIT License](./LICENSE) 開源。

“Nintendo”與“Animal Crossing／動物森友會”是其各自權利人的商標。本專案僅描述使用者熟悉的聲音類型，與其權利人沒有關聯。

## English quick start

Island Chatter turns text into original, game-like character chatter directly inside After Effects. Enable **Allow Scripts to Write Files and Access Network**, then run `IslandChatter.jsx` from **File > Scripts > Run Script File…**. To dock it, install the file in `Scripts/ScriptUI Panels`, restart AE, and open it from the **Window** menu.

The generated audio is procedural and original. No game samples or proprietary assets are included.
