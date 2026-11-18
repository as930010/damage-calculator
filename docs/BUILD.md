# 建置與部署輸出

## 指令與入口

使用 Node.js 24 與 package.json 指定的 pnpm：pnpm install --frozen-lockfile，再執行 pnpm run build。scripts/build.mjs 為整站入口；.github/workflows/pages.yml 在 build 後執行 test:build、test:production 及其餘正式測試，全部通過才上傳 site-dist/ 並部署 GitHub Pages。

整站建置包含傷害計算機 `/`、冰裝最佳化試算 `/ice-optimizer/`、隊伍增益模擬 `/buff-simulator/` 及變換評分 `/transformation-score/`。本機可用 node scripts/preview.mjs 4178 --base=/damage-calculator/ 檢查 GitHub Pages 子路徑；preview 只讀取產物，使用 no-store，不代表 Pages 的實際快取。

## 主要步驟及目錄

1. 安全清理已確認的生成目錄，編譯根目錄 TypeScript 至 dist/；保留供 Node 測試使用的模組與公開資料。
2. 彙整遊戲 JSON、裝備目錄及範例資料，產生資料版本；壓縮首頁引用的 CSS。
3. 執行 features/buff-simulator/scripts/build.mjs，編譯並產生 Buff 自己的 dist/、site-dist/，再納入整站。
4. scripts/production-assets.mjs 使用 esbuild 打包、壓縮、Tree-shaking 與 Code Splitting，產生首頁入口及延後載入的匯入／匯出 Chunk。
5. 整站建置器另外打包冰裝與變換評分入口、冰裝 Worker 及共用 Chunk；替換各入口的資料、樣式與程式引用，並為冰裝提供 Worker URL。
6. 無條件輸出共用主題 CSS、JS、五張 SVG，對四頁加入相同 bootstrap 與選擇器資源，最後寫入整站清單。

site-dist/ 的主要結構：

    index.html
    assets/                 首頁、冰裝、變換評分、Worker、Chunk、CSS、主題 JS/CSS/SVG
    data/                   內容版本化的公開遊戲資料與範例
    ice-optimizer/index.html
    transformation-score/index.html
    buff-simulator/
      index.html
      assets/               Buff 入口、CSS 與相關資源
      data/                 Buff 公開資料、按需技能資料
      asset-manifest.json
    asset-manifest.json
    .nojekyll

實際 Hash 檔名與依賴以 manifest 為準，不應硬編碼。本機 dist/ 及 features/buff-simulator/dist/ 不是部署入口。

## 共用與獨立資源

首頁、冰裝與變換評分共用同一份根目錄公開遊戲資料，冰裝另有搜尋 Worker。Buff 使用自己的資料與入口，技能 JSON 按需請求。整站整合由 scripts/site-resources.mjs 檢查 Site Shell／活動 CSS 內容一致後，將 Buff 的 HTML 與 Manifest 引用改至根目錄雜湊 URL，移除整站內重複產物；四頁解析後使用相同 URL。Buff 獨立輸出不受影響。

五主題選擇器來自 theme-preview/themes.js、themes.css 與 cards/，四頁引用同一組整站 assets。共存節 CSS 保持獨立且只有一個活動連結；media 啟停與 data-preview-theme 互斥控制視覺。建置最後注入主題 CSS／JS，保留活動 CSS 原位置。活動資源可獨立停用：首頁與 Buff 同時移除活動 link 後，冰裝與變換評分均省略活動表，四款常規主題仍存在；無活動時預設及舊 seasonal 偏好回退至預設。詳見 EVENT-ROLLBACK.md。

單獨執行 node features/buff-simulator/scripts/build.mjs 只產生 Buff 的獨立輸出，不會產生整站四頁、冰裝 Worker 或整站五主題注入；它不能取代根目錄 build 作為正式部署來源。

## 資料保護與版本 URL

scripts/public-game-data.mjs 排除維護檔案及內部註記，驗證來源識別碼及有限數值，拒絕含憑證的公開資料。首頁與 Buff 共用此發布邊界，冰裝與變換評分使用根目錄彙整資料。配裝 values 欄位 ID、compact v3 數字代碼與保存格式不變。

JS 入口及 Chunk 使用 esbuild 內容版本；CSS、JSON 與主題 SVG 等資源使用內容 Hash。HTML、Manifest 與動態匯入引用一致版本 URL，支援 /damage-calculator/ 子路徑。HTML 的 Description 與絕對 Canonical 保留在輸出，不隨本機 base 改寫。

HTML 與 Manifest 包含匯入／匯出 Chunk 相同版本 URL。首次載入失敗後，再次操作會加上有上限的 retry 參數，避開失敗模組紀錄；最多三次重試，成功後共用模組。舊資源已被部署移除時仍可能失敗，需重新整理取得新 HTML；程式不自動重新整理或覆寫配裝。

## 快取與完整性

內容版本只保證 URL 與依賴一致性，無法指定 GitHub Pages 的 HTTP Cache-Control。HTML、CSS、JS 與資料的實際快取標頭應在部署後確認；根目錄遊戲資料請求使用 force-cache，內容改變會產生新 URL。不能將本機 no-store 視為正式站政策。

每次建置先使舊輸出失效，只清理已確認、沒有 Symlink／Junction 的生成目錄。資源在記憶體完成打包及引用檢查後寫出，asset-manifest.json 最後寫入表示輸出完成；不保留歷史 Hash 檔案。持續開啟的舊頁面可能找不到舊 Chunk，應保留可恢復的錯誤提示。

## 驗證

執行 pnpm run test:build，驗證可重現性、版本更新、CSS 獨立失效、清單及引用完整性；執行 pnpm run test:production，以既有 DOM Harness 驗證首頁與 Buff 產物、延後載入、狀態保護及四頁 Metadata／版本歷史。冰裝 Worker UI 與排名由 pnpm run test:ice 涵蓋。變換評分的公式、取整與配裝整合由 `pnpm run test:score` 驗證。主題隔離使用 pnpm run test:theme-isolation。

正式發布還需依變更範圍完成四頁瀏覽器 Smoke Test，確認 CSS／JS／SVG／JSON 載入與 Pages 子路徑；不能只因 build 或 push 成功就宣稱部署完成。

### 隊伍增益職業資料維護

`features/buff-simulator/data/class-effects.json` 使用 Schema 2：每職業一份共用 `effects`；僅有模式差異時提供完整替換的 `challengeEffects`。職業增幅由計算核心即時計算，不保存衍生分數。技能參照僅供說明，不參與效果矩陣計算；實際技能仍可能受被動或條件影響。挑戰雙隊沿用既有共享場地來源去重與計算流程。

VI 已依 2026-09-09 平衡移除「猛虎4式：怒濤」的破甲參照，保留技能本身的遊戲存在性；破防由 15% 與 5% 乘算合併為 19.25%。戰鬥破防採快照，職業資料更新時應提醒重新引用，不自動覆寫舊快照。

LA 的「無視防禦加算」與外部破防分開傳遞，先加至受益角色裝備無視防禦組，再套用原防禦倍率；Buff 基礎輸出不包含此額外效益，另以首頁保存配裝（沒有面板時採 0%）顯示。整站建置提供唯讀配裝適配入口，僅有此效果時延後讀取；Buff 獨立輸出沒有首頁時採 0%。目前 60 職業兩模式皆共用效果，未使用 challengeEffects。LA Buff 保留原來源的 5% 攻擊與 8.25/235 致命傷害換算；移除固定 1.0382，獨立 Debuff 為 5%。

隊伍破防快照保留 dataRevision 與 sourceRevision；新增可選 defenseIgnoreAdditive、defenseIgnoreSources，舊快照缺值視為 0。資料過期只提醒重新引用，不自動改寫。切回手動／逐項模式不套用快照加算。

## 配裝資料與備份相容性

遊戲資料由 `scripts/build.mjs` 彙整成 `dist/data/game-data.json`。`frontend/catalog-index.ts` 供首頁 Picker 與匯入驗證查詢選項，編輯中的值保存在 Schema 3 的 `LoadoutState`。`frontend/loadout-archive.ts` 將欄位 ID、字串字典、快照及 Baseline 差異寫入檔案。`frontend/loadout-transfer.ts` 與 `frontend/loadout-profiles.ts` 分別處理畫布及正式配置，首頁在套用或還原前驗證目前的遊戲資料。

| 變更 | 維護位置與步驟 |
| --- | --- |
| 新增裝備或時裝 | 在 `data/equipment/` 對應目錄新增唯一且永久的 item ID、部位與選項名稱。同一欄位使用的保存名稱也必須唯一。已有部位會自動遍歷新項目。新部位另檢查 `data/simulator-equipment-mapping.json` 與 `data/equipment-layout.json` 的綁定。 |
| 新增魔法石或魔力石 | 一般魔法石在 `data/equipment/magic-stones.json` 定義武器、防具各自的名稱與效果。武器彩色魔力石讀取 `data/weapon-grade-options.json`，巨型魔力石讀取 `data/giant-magic-stones.json`。既有欄位可直接承載新選項。 |
| 新增鑑定 | 武器、防具分別使用 `data/weapon-appraisals.json`、`data/armor-appraisals.json`。飾品在 `data/accessory-special-effects.json` 設定部位或單件專屬選項，並在裝備目錄確認可鑑定條數。選項測試會依條數及目前裝備建立有效配裝。 |
| 新增配裝欄位 | 在 `frontend/field-transfer-codes.ts` 配發高於歷史最大值的新整數，更新相關 UI、Schema 驗證或資料綁定。在 `tests/fixtures/data-contract/` 新增 `field-map-v1-additions-YYYYMMDD.json`，只列該批語意欄位及 ID。原始 v1 表與已發布補充檔保留供審查。 |
| 移除、改名或改變語義 | 保留舊 ID。單一配裝 v3 的裝備依 item ID 雜湊讀取，v4 及配置庫 v2 的裝備值則保存選項字串。只改 UI 顯示字詞可沿用 `frontend/attribute-label.ts`。更改保存字串、沿用舊名稱給新物件、停用舊物件時，要針對舊備份制定明確轉換或拒絕政策。新增一個 JSON 的 `aliases` 欄位本身不會啟動遷移。 |
| 調整 Schema 或 Codec | 改工作狀態的型別、必要欄位、預設值或資料語義時，檢查 `parseState`、`snapshot` 與舊資料遷移。改欄位映射解讀、字典標記、快照或差異格式時，新增對應版本與解碼路徑，保留舊解碼器及範本。Schema 3 的 `values` 支援字串與數字，布林設定使用具名欄位。 |

### 本機驗證

使用 Node.js 24 與專案指定的 pnpm，在專案根目錄執行下列命令。更新 TS 或來源 JSON 後需重新建置，測試才會讀到新的資料與編譯模組。

```sh
pnpm run typecheck
pnpm run validate:data
pnpm run build
pnpm run test:data-contract
pnpm run test:profiles
```

`test:data-contract` 使用固定 Seed、正式匯入入口及隔離的首頁 DOM／Storage。遇到 Seed 失敗，可在建置後執行 `node --experimental-vm-modules --test --test-name-pattern="seed 1597" tests/archive-contract.test.mjs`，把數字換成失敗報告的 Seed。斷言會列出案例與深度差異。遇到欄位或目錄識別失敗，先依欄位名、item ID、適用部位核對歷史快照。遇到畫布失敗，依序核對 Picker 顯示值、保存值與再次匯出的型別。

固定歷史樣本涵蓋單一配裝 v3／v4、正式配置 v2、配置庫 v1／v2，以及五個曾遺失的鑑定欄位。舊檔的可讀性與新資料的遍歷分開驗證。發布新增選項後，可追加該版本的匿名舊檔與有意義的還原斷言，以保護新發布的保存值。固定樣本沒有自動更新指令。改變效果數值時，另跑對應的傷害或技能測試。

現有 Pages 工作流程在上傳建置產物前執行 `test:data-contract`、`test:profiles`、正式資源與 Smoke 等測試，任一步失敗會停止發布。

## 共用主題介面規範

四個工具共用 `frontend/site-shell.css` 的元件尺寸、字級、間距及狀態。預設色值留在 Site Shell。薄霧、森林、夕陽透過 `theme-preview/themes.css` 的 `data-preview-theme` 配色映射，共存節只在活動 stylesheet 的 `media` 為 `all` 時提供 Token。新增控制元件時先接到共用語義規則，主題樣式表只提供配色或裝飾例外。

| 語義 | 共用規則 |
| --- | --- |
| 表面 | 頁面底色由既有 Site Shell 提供，面板用 `--site-surface`，次要操作用 `--site-control-surface`，輸入用 `--site-field-surface`，選取與主要操作用 `--site-action-surface`。 |
| 邊框與文字 | 使用 1px 邊框。互動邊框依 `--site-control-edge` 和 `--site-control-hover-edge`，選取邊框用 `--site-action-edge`。一般文字用 `--site-text`，說明用 `--site-muted`，錯誤、警告、成功用 `--site-danger`、`--site-warning`、`--site-success`。 |
| 普通動作 | 共用 44px 最小高度、10px 圓角、14px 水平內距、13px／600／1.4。首頁的儲存與設為比較基準沿用普通動作外觀。開始搜尋與套用搜尋結果採主要外觀。刪除仍有確認流程，入口用危險色標示。 |
| 欄位 | 繼承 Site Shell 字體堆疊（Inter、Segoe UI、微軟正黑體及 sans-serif），普通欄位採 14px、1.5 行高與 44px 最小高度。高度不足以容納內容時允許自然增加。Boss 條件、電路板與支援彈匣等緊湊欄位採 36px 最小高度、13px。搜尋選單保留清除按鈕預留空間。 |
| 互動 | Hover 只提高表面和邊框的可辨識度，Active 壓低填色。選取和焦點分開使用邊框及外框。鍵盤外框用 `--site-focus-ring`，2px 寬、偏移 2px。複合欄位只在外框顯示焦點，停用疊加陰影。 |
| Disabled／Readonly／Invalid／Loading | 原生禁用狀態使用一致背景、文字、邊框與游標。唯讀欄位可選取文字，保留可讀對比並使用虛線。已有 `aria-invalid` 的欄位使用錯誤邊框。冰裝搜尋中的按鈕繼續顯示進度與主要操作底色。 |
| 排版與間距 | 面板標題 17px／650／1.4，欄位標籤與說明 13px，說明行高 1.55。沿用 4／8／12／16／24px 既有間距單位。主要按鈕群的間距用 8px Token。 |

配置標籤、頂部導覽、收合標題、圖示按鈕、複選框及計算結果維持各自用途的尺寸。裝備槽色彩、品質提示、增減幅及密集結果表格也各有用途。新增元件時先比對相同功能的既有規則，並以預設及四款其他主題實測 `disabled`、鍵盤焦點及窄版換行。
