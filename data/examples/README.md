# Google Sheets 輸入範例

`live-sheet-2026-09-28.json` 於 2026-09-28 從[目前使用的 Google Sheets](https://docs.google.com/spreadsheets/d/11_e193bPTA5ykzhXSS4uptEU_w0midIJGqmhleGeMQY/edit)匯出的 `DaB 9_23.xlsx`，擷取「裝備模擬區」已填寫的網站輸入格。檔案符合網站的 `LoadoutState` 格式，包含 216 個 `values` 欄位、職業 `DaB` 及 `F20` 對應的切換狀態。

數字保留試算表原生值；標籤與公式儲存格未匯入。`B27:B29` 三個右冰套效選擇已一併納入，網站只會計算使用者選取的套裝，並依其已裝備件數套用效果。

`live-sheet-2026-09-28-expected.json` 記錄同次匯出的「計算機」原值；`b163RecomputedFromFormula` 是以 B163 原式及來源值另外重算的參考值，並非 Google Sheets 未顯示的內部精度。開啟網站時在網址後加上 `?sample=live-sheet-2026-09-28`，即可在不覆蓋原配裝的範例模式中查看逐格比對。差異追查見 `docs/live-sheet-comparison-2026-09-28.md`。
