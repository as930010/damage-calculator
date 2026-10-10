# 共存節活動主題

活動視覺效果集中在 `frontend/seasonal-effects.css`，由主線 `index.html` 載入；計算、狀態管理與資料不依賴此樣式。GitHub Pages 只從 `main`／`master` 發布，避免多個分支競爭並覆寫同一個正式網站。活動分支僅供開發及檢視，部署前必須先合併到 `main`。

活動結束時，在 `index.html` 移除 `seasonal-effects.css` 連結及其相鄰的 `visibilitychange` 裝飾動畫同步程式，然後在 `main` 執行一般提交與 Pages 部署。不要回滾功能提交或將主線重設到舊提交；這樣能保留活動期間加入的計算、資料與 UI/UX 改善。
