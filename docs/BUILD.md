# 建置與部署輸出

- 使用 Node.js 24 與 package.json 指定的 pnpm，執行 `pnpm install --frozen-lockfile`。
- `pnpm run build` 每頁執行一次 TypeScript 編譯，再從編譯出的 ESM 進行 esbuild 打包、壓縮與 Tree-shaking。
- `dist/` 與 Buff 的 `dist/` 保留正式 Node 測試使用的模組及公開資料；不是部署入口。
- `site-dist/` 是正式部署輸出，含主頁及 `buff-simulator/`。GitHub Actions 上傳這個目錄，`pnpm run preview` 也只讀取這個目錄。
- `pnpm run preview -- 4173 --base=/damage-calculator/` 可驗證 GitHub Pages 子路徑。
- `pnpm run test:build` 驗證可重現性、版本更新、CSS 獨立失效與引用完整性。`pnpm run test:production` 使用既有 DOM Harness 執行兩頁打包產物。

遊戲資料由專案內的 JSON 維護，來源識別碼與欄位映射直接使用語意名稱。`scripts/public-game-data.mjs` 排除維護檔案與內部註記，驗證來源識別碼及有限數值，並拒絕包含憑證的公開資料。主頁與 Buff 共用這個發布邊界。配裝 `values` 欄位 ID、compact v3 數字代碼及保存格式不變。

JS 入口及 Chunk 由 esbuild 產生內容版本；各 CSS、公開 JSON 分別使用 SHA-256 的前 16 碼。活動 CSS 保留獨立連結，移除來源 HTML 的連結即可停用。Buff 技能 JSON 保持按需請求；主頁匯入／匯出 Chunk 在使用功能時載入。

HTML 與 Manifest 包含匯入／匯出 Chunk 的相同內容版本 URL。首次載入失敗後，手動再次操作會在這個 URL 加上有上限的 retry 參數，以避開瀏覽器的失敗模組紀錄；最多三次重試，成功後共用同一模組。資源已在新部署被移除時，重試仍可能失敗，必須重新整理取得新版 HTML。此流程不會自動重新整理或覆寫目前配裝。

每次建置先使舊正式輸出失效；只清理已確認、沒有 Symlink／Junction 的生成目錄。資源在記憶體完成打包及引用檢查後才寫出，`asset-manifest.json` 最後寫入，代表輸出完成。CI 另驗證清單、檔案內容與引用，失敗時不部署。不保留歷史 Hash 檔案。

內容版本控制的是 URL 與依賴一致性，無法指定 GitHub Pages 的 HTTP Cache-Control。部署後仍需確認實際快取標頭。部署切換期間，持續開啟的舊頁面可能找不到已移除的舊 Chunk；功能載入錯誤會顯示失敗訊息並允許再次操作，必要時重新載入頁面。
