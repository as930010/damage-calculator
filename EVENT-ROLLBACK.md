# 共存節活動主題

## 現行架構

main 是唯一長期維護基準。目前正式網站三頁均提供五個互斥選項：預設、共存節、薄霧、森林、夕陽；沒有工作階段偏好時預設共存節。

共用選擇器位於 theme-preview/themes.js，卡片及常規配色位於 theme-preview/themes.css，縮圖位於 theme-preview/cards/。名稱雖保留 preview，scripts/build.mjs 已將這些資源正式輸出至 site-dist/assets/，三頁共用同一組資源。

共存節是 frontend/seasonal-effects.css 的獨立純視覺模組，目前沒有專屬 JavaScript 生命週期。功能、資料、共同 UI/UX、無障礙與 RWD 必須留在核心程式，不能移入活動資源。

## 載入順序與隔離

首頁先載入 styles.css、polish.css、site-shell.css，再載入 seasonal-effects.css；冰裝使用 site-shell.css 與自身 styles.css，Buff 使用自身 styles.css 與共用 site-shell.css，活動表在各頁基礎樣式之後。整站建置最後加入 themes.css 與 defer 的 themes.js。

建置會標記唯一活動連結為 data-theme-seasonal，並插入首次繪製前的主題 bootstrap。選擇共存節時活動表 media 為 all，其他選項為 not all；薄霧、森林、夕陽使用根元素 data-preview-theme，預設與共存節清除此屬性。常規配色不能與活動樣式疊加。最終規則仍依 CSS Cascade、選擇器權重、來源順序及作用域決定，不代表最後一份檔案的所有規則一律勝出。

偏好沿用 sessionStorage 的 damage-calculator-preview-theme；preview-theme URL 參數優先於工作階段偏好。不得把視覺停用變成清除配裝或回滾功能提交。

## 現在可用的停用程序

1. 使用頁首主題入口選擇「預設」或其他常規主題。這會停用活動表並保留完整選擇器，工作階段內跨頁、重新整理保持選擇。
2. 本機檢查可用 ?preview-theme=original，或以 node scripts/preview.mjs 4178 --base=/damage-calculator/ 啟動正式產物。
3. 只為檢查無活動資源的輸出時，可使用 preview 的 --without-seasonal；此模式會移除活動連結及整合的選擇器注入，不適合作為保留五主題功能的正式停用方案。

## 永久停用活動資源

在首頁與 Buff 來源 HTML 同時移除 seasonal-effects.css 的 link，再執行整站建置；冰裝活動連結由根建置器依首頁是否提供活動資源決定。先移除所有來源引用，才可移除活動 CSS 檔案。不可只刪除仍被 HTML 引用的來源檔。

scripts/site-resources.mjs 無條件整合共用選擇器及常規配色，活動 link 存在時才標記及啟停活動表。活動缺席時不顯示共存節卡片，初始主題及舊 seasonal 工作階段偏好回退至「預設」；其餘四款及工作階段保存繼續正常運作。正常版本仍預設共存節。本機 preview 的 --without-seasonal 是舊診斷模式，不代表這個正式建置流程。

整站整合只在共用 CSS 內容完全相同時，把 Buff 的 Site Shell／活動資源引用改為根目錄雜湊 URL；Buff 獨立建置仍輸出自己的完整資源。兩頁活動引用不一致時建置會拒絕整合，避免發布殘缺主題。

## 驗證

執行 pnpm run test:theme-isolation、pnpm run build、pnpm run test:build、pnpm run test:production。另以三頁實際切換預設 → 共存節 → 常規配色，檢查活動裝飾完全啟停、工作階段保存、配裝與焦點操作不變。視覺模組調整需比較手機與桌面的元件尺寸與位置，保留活動專屬背景、偽元素及動畫。

## 發布紀錄維護

新版本必須在 index.html 的 site-release-list 前方追加 li，不可取代第一筆歷史。只更新三頁當前 Footer 版本；既有歷史日期與說明保留。test:production 會檢查版本唯一性、排序、v3.04.18／v3.04.19 及更早歷史內容，升版時應更新當前 Footer 預期而保留歷史保護。
