<div align="center">
  <img src="./public/app-icon.png" width="96" alt="NAI Atelier 工坊圖示" />

  # NAI Atelier

  **面向 NovelAI 的個人本地創作工坊**

  **[简体中文](./README.md) · [繁體中文](./README.zh-TW.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md)**

  [原始碼版本](./package.json) · [下載](https://github.com/HelloQun54321/nai-atelier/releases) · [更新紀錄](./CHANGELOG.md) · [MIT 授權](./LICENSE)
</div>

## 專案介紹

NAI Atelier 是在 Windows 電腦或 Android 手機上執行的 NovelAI 個人工坊，串起「尋找參考 → 組合提示詞 → 生成一張 → 觀察與微調 → 保存為可重用資產」的創作流程。

風格串、角色、Vibe 編碼、收藏與生成歷史原圖保存在自己的工坊。生圖與 AI 助手使用你的憑據連接線上服務，應用程式並未在本機執行 NovelAI 生圖模型。產品面向個人使用與可信任的家庭區域網路。

本專案基於 [kirafishy/NaiPromptManager](https://github.com/kirafishy/NaiPromptManager) 二次開發並獨立維護。

## 界面預覽

共用截圖使用簡中界面並開啟圖片安全模式，供了解版面配置；應用程式也支援上方列出的其他語言。

<div align="center">
  <img src="./docs/screenshots/desktop-presets-gallery.webp" width="860" alt="風格串與可重用預設" />
  <p>風格串與可重用預設</p>
  <img src="./docs/screenshots/desktop-lab-workbench.webp" width="860" alt="生圖實驗室" />
  <p>四模式生圖實驗室</p>
  <img src="./docs/screenshots/mobile-presets-gallery.webp" width="300" alt="手機透過區域網路訪問電腦工坊" />
  <p>手機瀏覽器的電腦工坊入口</p>
</div>

## 快速上手

| 使用方式 | 執行需求 | 開始方式 |
| --- | --- | --- |
| **Windows 安裝版** — 電腦日常使用建議選擇 | Windows 10/11 x64，無需 Node.js 或 Git | 從 [Releases](https://github.com/HelloQun54321/nai-atelier/releases) 取得已發布的 `NAI-Atelier-Setup-*.exe` 與 `.sha256` |
| **原始碼部署** | Node.js 22+（建議 24.x）、Git | 複製儲存庫並執行下方命令 |
| **獨立 Android APK** | Android 8.0+、ARM64、更新的 Android System WebView | 安裝提供的或自行建構的 APK，詳見 [Android 說明](./docs/ANDROID_STANDALONE.md) |

原始碼版本可能與公開下載版本不同。本地建構不會自動產生公開發行或應用內更新，可下載版本以 Release 實際附件為準。

### Windows

1. 執行安裝程式，選擇安裝語言及程式資料夾。安裝器會檢查 Microsoft Visual C++ x64 執行階段；缺少時依提示安裝，再重新執行工坊安裝程式。
2. 從桌面、開始功能表，或安裝資料夾內的 `NAI Atelier.exe` 開啟 **NAI Atelier**。
3. 在「**全局設定 → NovelAI 與 Anlas**」新增自己的 NovelAI `pst-` Key，並設定該 Key 的 Anlas 本地預算。
4. 在「**全局設定 → 資料與維護 → Tag 補全詞庫**」選擇「**檢查並更新**」。
5. 進入「**實驗室**」的文生圖，輸入提示詞、選擇模型與參數，查看費用提示後生成；滿意的配置可保存為風格串。

關閉 Windows 視窗會收進系統匣，本地服務繼續執行。要停止工坊，請在系統匣或應用功能表選擇「**退出工坊**」。按 `Alt` 可顯示功能表，其中可開啟資料目錄及啟動日誌，詳見 [Windows 說明](./docs/WINDOWS_DESKTOP.md)。

### 原始碼部署

```bash
git clone https://github.com/HelloQun54321/nai-atelier.git
cd nai-atelier
npm ci
npm run dev:local
```

等待服務顯示就緒後，開啟 [http://localhost:3000](http://localhost:3000)。安裝相依套件後會自動建立 Windows 桌面捷徑。完整原始碼啟動器會重新建構，並重啟屬於本專案的既有服務；再次啟動前請先完成正在執行的任務。

### 界面與助手語言

在「**全局設定 → 外觀與畫廊 → 語言**」選擇簡中、繁中、英語、日語或韓語。界面即時切換，依目前瀏覽器／裝置記住選擇；Windows 標題、啟動頁、功能表、系統匣與收集窗同步，安裝向導也提供這五種語言。

「**創作助手**」從下一次請求起使用所選語言交流，包含進度與回答。已有對話、Prompt、Tag、自訂資產名稱與外站內容保留原文；明確指定的創作產物語言優先於交流語言。

界面譯文隨應用提供，不需要線上翻譯服務。Tag 補全詞庫仍為中英對照，切換界面語言不會翻譯詞庫。

## 手機使用

### 透過區域網路訪問電腦

手機與電腦連接同一可信任 Wi-Fi，在「**全局設定 → 資料與維護 → 局域網訪問**」複製目前地址，輸入四位 PIN。這種方式使用電腦工坊的資料，電腦必須保持執行。安裝版遇到連接埠衝突可能改用其他連接埠，請以設定頁或本次啟動日誌的地址為準。

生圖與經網關代理的請求使用電腦網路；手機瀏覽器直接開啟的網站仍取決於手機網路。這是家庭區域網路功能，不是公開網站部署。

觸控支援長按顯露圖片操作、大圖檢視、雙指縮放、雙擊縮放與平移。退出詳情後保留原本瀏覽位置；手機實驗室將編輯內容分為底圖、提示詞與參數頁籤。

### 獨立 Android

APK 在手機上執行自己的工坊，包含四種生圖模式、資料庫、助手與可選的本地反推，使用手機網路、儲存與憑據，不會自動合併或同步電腦資料。

桌面剪貼簿監聽、電腦目錄、本機 SillyTavern 橋接與 EXE 更新屬於電腦功能。Android 透過系統檔案選擇器匯出。**解除安裝 Android 會刪除應用私有資料**，請先匯出加密備份；同簽章且建構號更高的 APK 可覆蓋更新，詳見 [Android 說明](./docs/ANDROID_STANDALONE.md)。

## 核心創作流程

### 風格串與參考

- **風格串**保存可重用的提示詞模組、負面詞、角色、Seed、採樣參數與參考。角色提示詞和構圖位置各自獨立，定位方式跟隨所選模型能力。
- **離開前儲存**：風格串或自訂角色有未儲存變更時，可選「儲存並離開」「放棄並離開」或「繼續編輯」。儲存成功才跳轉，失敗保留草稿；目前無法完整存入資料庫的編輯模式仍只提供繼續／放棄。
- **卡片操作**：風格串與自訂角色卡片左上角有紅色刪除按鈕，右上依序直排「下載圖片 → 複製圖片 → 編輯資訊」，收藏在名稱旁；滑鼠移入、鍵盤聚焦或手機長按後顯示。確認後刪除條目及本機預覽，沒有封面也能刪除與編輯。角色 Tag 詞庫條目不提供刪除。
- **Windows 收集模式**在啟用懸浮窗時監聽複製的圖片連結，下載原圖並提取內嵌生成資訊，保存為可重用預設；支援暫停、繼續、折疊與進度，不打斷目前應用。
- **Vibe Transfer**在支援的模型上提取畫風編碼並保存在本地；新編碼可能消耗 Anlas，已有編碼可重用。支援的模型最多使用 16 個 Vibe，參考附加費依目前規則估算。
- **Precise Reference**在支援的模型上提供角色／畫風參考。不將 V4／V4.5 的能力套用至 V5，界面依目前模型及同步能力顯示。

### 四種實驗室模式

| 模式 | 主要行為 |
| --- | --- |
| **文生圖** | 探索提示詞、角色與構圖；支援的模型可生成透明背景 |
| **圖生圖** | 更換底圖保留目前提示詞與參數，需要時主動匯入原圖配置 |
| **局部重繪** | 塗抹蒙版，或以聚焦重繪裁切放大選區、生成後回貼原圖 |
| **擴圖** | 向各方向延展畫布並重繪邊界接縫 |

圖生圖輸出可保留原尺寸、縮至目前免費像素範圍，或設定自訂尺寸。請求只縮放副本，原始資產保留。聚焦重繪按裁切請求估算費用，擴圖按最終畫布估算；符合免費像素範圍不代表請求必然零 Anlas。

實驗室提供推薦步數與可選的免費步數鎖，尺寸、步數與參考由你決定。支援的模型提供流式過程圖；各模式保留自己的工作狀態，自由實驗室重新開啟時恢復文字與參數草稿，圖片工作區從空開始。

### 歷史、資料庫與分享

- 生成歷史在本地保存原圖與實際 Prompt、Seed、參數，可匯入實驗室繼續加工，支援大圖瀏覽、收藏與隨機排序，保留原件。
- AITag 提供公開生成案例與參數索引；Pixiv 提供排行榜、搜尋與畫師作品；Danbooru 提供圖片／Tag 參考。畫師庫與角色庫便於發現、取用，收藏庫保存主動選擇的素材。
- **收藏庫**用收藏夾歸組、標籤交叉查找；已有標籤可搜尋和重用，收藏夾、來源及多個標籤可疊加篩選。保存時可選最近使用的收藏夾或先放入「未整理」；電腦可拖曳單張或已選多張作品，觸控和鍵盤可用移動控件整理。
- 圖片下載／複製操作在滑鼠懸停、鍵盤聚焦或觸控長按時顯露。啟用「分享圖片時移除生成資訊」後，分享產生清洗副本，原圖與資訊保留；清洗失敗會提示。
- Tag 補全支援中英文查找、連續權重群組與 `Shift` 點擊微調。詞庫和目錄規模依安裝資料集而定；可選的 AI 補譯使用已配置 LLM 及其計費規則。
- WD ViT V3、WD SwinV2 V3、WD EVA02-Large V3 在明確下載模型後，以本地 CPU 反推 Tag。在「**全局設定 → 生圖偏好與實驗室**」管理；反推不消耗 Anlas，也不需要上傳雲端推理，速度與記憶體用量取決於模型和裝置。

### 創作助手

從側欄或浮鈕開啟助手，可感知目前頁面、調整實驗室草稿、操作資產，或透過畫布工具設定蒙版與選區。電腦版可訪問已授權的本地圖片目錄及匯出檔案；Android 檔案工具只在應用內創作目錄工作。

權限為「**只讀**」、「**標準**」與「**完全訪問**」三檔。生圖、刪除與清空仍須由創作者確認，保留既有資產與後續人工修改。模型供應商與憑據獨立於 NovelAI 設定，模型使用可能另行計費。

## 費用、Key 與隱私

- **Anlas**、**Opus 額度**、**本地預算**與**官方餘額**各有不同含義。預算與用量按 Key 隔離；本地預算不是官方帳戶餘額，也不是實際扣費保證。
- 零 Anlas 資格取決於活躍訂閱、模型、實際尺寸與步數、剩餘 Opus 額度和參考，編輯模式也可能符合。訂閱過期不等於 Key 必然失效，權限與可用點數依官方回應判斷。
- 工坊從 NovelAI Web 應用同步模型能力、免費門檻與成本係數；提取失效時保留最近完整規則並提示問題。生成或新參考編碼前查看估算，依提示確認付費；最終扣費由服務決定。
- Opus 百分比與可用張數按同步規則換算，屬於估算，不是固定張數承諾。
- 多組 NovelAI Key 可設定別名，界面預設遮罩 Key。安全模式模糊圖片；外觀設定包含明暗、強調色、密度、圓角、字體與畫廊版面。
- **st-chatu 排隊**只用 Key 指紋協調，不向隊列送出原始 Key、Prompt 或圖片；**相容生圖中轉**實際執行請求，因此接收目前 Key、提示詞與所需參考。第三方計費未適配，官方費用估算不是中轉服務的報價。
- 取消中轉連線只停止本地等待，遠端生成是否停止由服務決定；失敗不自動重發付費請求，也不自動回退其他供應商。

## 資料與備份

| 工坊 | 持久保存的創作資料 |
| --- | --- |
| **Windows 安裝版** | `%LOCALAPPDATA%\NAI Atelier\workspace\local-data` |
| **原始碼部署** | `<專案根目錄>/local-data/` |
| **獨立 Android** | 應用私有 SQLite 與原圖檔案，透過應用加密備份匯出 |

Windows 安裝版與原始碼部署各用自己的工作區，Android 也獨立保存。另一入口出現空工坊不代表原資料遭覆蓋。Windows 程式目錄與資料目錄分開，解除安裝預設保留個人資料。

電腦備份使用「**全局設定 → 資料與維護 → 重要資料備份 → 立即完整備份**」，或完整停止對應服務後複製整個 `local-data/`。安裝版須透過「**退出工坊**」停服，不能只關閉視窗。瀏覽器尚未保存的草稿不包含在 D1／R2 備份內。

勿修改 `wrangler.toml` 的 D1 資料庫名稱／ID、R2 bucket 名稱與 binding，這些是既有本地存儲的定位鍵，改動可能讓應用載入全新空庫。原始資產與憑據屬於 `local-data`，縮圖與反推模型屬於可重建快取；手動備份請複製完整資料目錄。

Android 解除安裝、重置或換機前，請以至少八字元密碼匯出加密 `.naiatelier` 備份。內容包含原圖、資料庫、設定、Key 與助手／Pixiv 憑據；快取、詞庫與模型可重新下載，密碼遺失無法恢復。還原行為與空間需求見 [Android 說明](./docs/ANDROID_STANDALONE.md)。

## 更新

- **Windows**：在「**全局設定 → 資料與維護 → 應用更新**」檢查、下載，再選「**重啟並安裝**」。只顯示已發布版本；啟動時安靜檢查，普通退出不自動安裝。預設接受預發布，可自行關閉。安裝前完成生圖、助手、收集、備份及詞庫任務，重大變更前保留完整備份。
- **原始碼**：完成任務並停止原始碼服務後，Windows 執行儲存庫中的 `更新 NAI Atelier.bat`，macOS／Linux 執行 `sh scripts/update-local.sh`。更新器跟隨已發布版本，遇到定製分支、分叉或本地修改時停止；ZIP 下載沒有 Git 更新環境。
- **Android**：安裝同簽章且建構號更高的相容 APK。手機建構號與電腦／原始碼顯示版本分別維護，電腦發行不會自動重新建構或發布 APK。

## 互通與開發

SillyTavern 連接器與 st-chatu8 互通選定的風格串、Vibe 編碼與歷史原圖，詳見 [橋接說明](./docs/SILLYTAVERN_BRIDGE.md) 和 [連接器 README](./sillytavern-extension/npm-bridge/README.md)。

電腦端使用 React 19、TypeScript、Vite、Tailwind CSS，配合 Node 媒體網關與本地 Cloudflare Worker。持久層為本地 D1／SQLite 與 R2 相容物件，Sharp 處理縮圖，ONNX Runtime 執行反推。Android 共用手機界面，以原生 SQLite、檔案、網路與 ONNX Runtime 提供獨立能力。

| 命令 | 用途 |
| --- | --- |
| `npm run dev:local` | 啟動完整本地原始碼工坊 |
| `npm run dev` | 啟動 Vite 前端開發服務 |
| `npm run build` | 建構前端及 Worker |
| `npm run build:desktop` | 以公開原始碼建構 Windows 安裝包 |
| `npm run build:android` | 建構簽章 ARM64 Android APK |
| `npm run update:tags` | 更新並重建中英 Tag 詞庫 |
| `npm run test -- <路徑>` | 執行前端定向測試 |
| `npm run test:gateway` | 執行網關、橋接與本地後端測試 |
| `npm run test:live-sync` | 明確連網驗證官方常數提取 |

電腦包需要 Windows 建構環境；Android 另需 JDK 21 與 Android SDK。完整步驟見 [Windows](./docs/WINDOWS_DESKTOP.md) 與 [Android](./docs/ANDROID_STANDALONE.md) 說明，單純建構不會上傳發行。[AGENTS.md](./AGENTS.md) 維護協作規則，[VIBER_INTENT.md](./VIBER_INTENT.md) 維護產品意圖。

## 來源與延伸閱讀

- 原始專案：[kirafishy/NaiPromptManager](https://github.com/kirafishy/NaiPromptManager)，MIT。
- 中英 Tag 資料：[ffdkj Danbooru 翻譯表](https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table)。
- 互通與公共排隊參考：[damoshen123/st-chatu8](https://github.com/damoshen123/st-chatu8)。
- 本地反推模型：[SmilingWolf WD ViT Tagger V3](https://huggingface.co/SmilingWolf/wd-vit-tagger-v3)，Apache-2.0。

本 README 提供繁中使用說明。[簡中完整介紹](./README.md)、[產品決策](./docs/PRODUCT_DECISIONS.md)、[技術文檔](./docs/WINDOWS_DESKTOP.md)、[變更歷史](./CHANGELOG.md) 與 [作者個人吐槽原文](./README.md#一点个人吐槽) 目前以簡中維護。
