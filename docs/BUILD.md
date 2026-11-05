# 建置與部署輸出

## 指令與入口

使用 Node.js 24 與 package.json 指定的 pnpm：pnpm install --frozen-lockfile，再執行 pnpm run build。scripts/build.mjs 為整站入口；.github/workflows/pages.yml 在 build 後執行 test:build、test:production 及其餘正式測試，全部通過才上傳 site-dist/ 並部署 GitHub Pages。

正式三頁為傷害計算機 /、冰裝最佳化試算 /ice-optimizer/、隊伍增益模擬 /buff-simulator/。本機可用 node scripts/preview.mjs 4178 --base=/damage-calculator/ 檢查 GitHub Pages 子路徑；preview 只讀取產物，使用 no-store，不代表 Pages 的實際快取。

## 主要步驟及目錄

1. 安全清理已確認的生成目錄，編譯根目錄 TypeScript 至 dist/；保留供 Node 測試使用的模組與公開資料。
2. 彙整遊戲 JSON、裝備目錄及範例資料，產生資料版本；壓縮首頁引用的 CSS。
3. 執行 features/buff-simulator/scripts/build.mjs，編譯並產生 Buff 自己的 dist/、site-dist/，再納入整站。
4. scripts/production-assets.mjs 使用 esbuild 打包、壓縮、Tree-shaking 與 Code Splitting，產生首頁入口及延後載入的匯入／匯出 Chunk。
5. 整站建置器另外打包冰裝入口、Worker 及其共用 Chunk；替換冰裝 HTML 的資料、Worker、樣式與程式引用。
6. 無條件輸出共用主題 CSS、JS、五張 SVG，對三頁加入相同 bootstrap 與選擇器資源，最後寫入整站清單。

site-dist/ 的主要結構：

    index.html
    assets/                 首頁、冰裝、Worker、Chunk、CSS、主題 JS/CSS/SVG
    data/                   內容版本化的公開遊戲資料與範例
    ice-optimizer/index.html
    buff-simulator/
      index.html
      assets/               Buff 入口、CSS 與相關資源
      data/                 Buff 公開資料、按需技能資料
      asset-manifest.json
    asset-manifest.json
    .nojekyll

實際 Hash 檔名與依賴以 manifest 為準，不應硬編碼。本機 dist/ 及 features/buff-simulator/dist/ 不是部署入口。

## 共用與獨立資源

首頁與冰裝共用根目錄公開遊戲資料，冰裝另有搜尋 Worker。Buff 使用自己的資料與入口，技能 JSON 按需請求。整站整合由 scripts/site-resources.mjs 檢查 Site Shell／活動 CSS 內容一致後，將 Buff 的 HTML 與 Manifest 引用改至根目錄雜湊 URL，移除整站內重複產物；三頁解析後使用相同 URL。Buff 獨立輸出不受影響。

五主題選擇器來自 theme-preview/themes.js、themes.css 與 cards/，三頁引用同一組整站 assets。共存節 CSS 保持獨立且只有一個活動連結；media 啟停與 data-preview-theme 互斥控制視覺。建置最後注入主題 CSS／JS，保留活動 CSS 原位置。活動資源可獨立停用：首頁與 Buff 同時移除活動 link 後，冰裝不注入活動表，四款常規主題仍存在；無活動時預設及舊 seasonal 偏好回退至預設。詳見 EVENT-ROLLBACK.md。

單獨執行 node features/buff-simulator/scripts/build.mjs 只產生 Buff 的獨立輸出，不會產生整站三頁、冰裝 Worker 或整站五主題注入；它不能取代根目錄 build 作為正式部署來源。

## 資料保護與版本 URL

scripts/public-game-data.mjs 排除維護檔案及內部註記，驗證來源識別碼及有限數值，拒絕含憑證的公開資料。首頁與 Buff 共用此發布邊界，冰裝使用根目錄彙整資料。配裝 values 欄位 ID、compact v3 數字代碼與保存格式不變。

JS 入口及 Chunk 使用 esbuild 內容版本；CSS、JSON 與主題 SVG 等資源使用內容 Hash。HTML、Manifest 與動態匯入引用一致版本 URL，支援 /damage-calculator/ 子路徑。HTML 的 Description 與絕對 Canonical 保留在輸出，不隨本機 base 改寫。

HTML 與 Manifest 包含匯入／匯出 Chunk 相同版本 URL。首次載入失敗後，再次操作會加上有上限的 retry 參數，避開失敗模組紀錄；最多三次重試，成功後共用模組。舊資源已被部署移除時仍可能失敗，需重新整理取得新 HTML；程式不自動重新整理或覆寫配裝。

## 快取與完整性

內容版本只保證 URL 與依賴一致性，無法指定 GitHub Pages 的 HTTP Cache-Control。HTML、CSS、JS 與資料的實際快取標頭應在部署後確認；根目錄遊戲資料請求使用 force-cache，內容改變會產生新 URL。不能將本機 no-store 視為正式站政策。

每次建置先使舊輸出失效，只清理已確認、沒有 Symlink／Junction 的生成目錄。資源在記憶體完成打包及引用檢查後寫出，asset-manifest.json 最後寫入表示輸出完成；不保留歷史 Hash 檔案。持續開啟的舊頁面可能找不到舊 Chunk，應保留可恢復的錯誤提示。

## 驗證

執行 pnpm run test:build，驗證可重現性、版本更新、CSS 獨立失效、清單及引用完整性；執行 pnpm run test:production，以既有 DOM Harness 驗證首頁與 Buff 產物、延後載入、狀態保護及三頁 Metadata／版本歷史。冰裝 Worker UI 與排名由 pnpm run test:ice 涵蓋。主題隔離使用 pnpm run test:theme-isolation。

正式發布還需依變更範圍完成三頁瀏覽器 Smoke Test，確認 CSS／JS／SVG／JSON 載入與 Pages 子路徑；不能只因 build 或 push 成功就宣稱部署完成。
