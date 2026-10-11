# 開發副本清理工具

腳本：`tools/cleanup-development-artifacts.ps1`。本工具只處理明列的精確路徑，不掃描或擴大 Temp 清理範圍。預設只做唯讀預覽；實際清理需加 `-Execute`、逐類確認，並對特殊 Git 指標與 Reparse Point 分別確認。

## 本次稽核確認的殘留項目

`-ResidualOnly` 模式只檢查以下三個已逐項盤點的 Temp 副本，不會碰瀏覽器 Profile、舊快照、`dist` 或其他路徑：

- `C:\Users\user\AppData\Local\Temp\damage-calculator-buff-release`
- `C:\Users\user\AppData\Local\Temp\damage-calculator-buff-ab-20261011`
- `C:\Users\user\AppData\Local\Temp\damage-calculator-mobile-ab-20261011`

已知前者含兩個指向同一候選目錄內、但目標不存在的連結；Buff A/B 副本含指向正式專案 `node_modules` 的 Junction；Buff A/B 的 `.git` 是指向已不存在、且未登記 Worktree 的指標檔。腳本會在當次預覽重新驗證這些狀態；若實際狀態不同或無法讀取連結目標，該項會被阻擋。解除 Junction 只移除 Junction 本身，不會遞迴進入或刪除目標。

完整舊快照 `C:\Users\user\AppData\Local\Temp\damage-calculator-preintegration-20261011` 含恢復資料，因此已從清理白名單移除。不要刪除 `_codex_archives` 中的共用備份。

## 執行方式

在一般使用者權限的 PowerShell 中先預覽：

```powershell
Set-Location -LiteralPath 'C:\Users\user\Documents\ChatGPT\傷害計算機'
.\tools\cleanup-development-artifacts.ps1 -ResidualOnly
```

確認三條候選路徑、數量、容量與每一個連結目標都符合預期後，才可進入互動確認：

```powershell
.\tools\cleanup-development-artifacts.ps1 -ResidualOnly -Execute
```

腳本會要求輸入 `DELETE-B` 才納入這三個副本。含 `.git` 指標的副本還會要求 `DELETE-GIT`；這只適用於腳本重新驗證為失效、未登記的 `.git` 指標檔，並不允許刪除有效 Git 物件或 `.git` 目錄。每個 Reparse Point 都會單獨顯示完整路徑及目標，只有逐一輸入 `DELETE-LINK` 才會解除該連結本身。任何一個連結未同意，該候選資料夾會保持原狀；連結目標不在明確允許範圍時整項停止。

執行前請關閉使用這些副本的瀏覽器、編輯器、終端機與開發伺服器。腳本會檢查程序命令列是否明確包含候選路徑；這只能發現明確的命令列參照，不能證明沒有其他程序持有檔案控制代碼。若程序查詢失敗，腳本會停止。存取被拒、路徑／連結狀態變動或出現不支援屬性時，也會停止該項。

腳本不修改 Execution Policy，不要求系統管理員權限，不呼叫其他清理工具。PowerShell 版本若無法可靠讀取連結目標，候選項會安全停止。執行日誌寫入 `%LOCALAPPDATA%\DamageCalculatorCleanupLogs`；預覽不建立日誌、不變更檔案。清理完成後可再執行預覽核對路徑狀態。

## 明確保護範圍

不處理正式專案原始碼、計算資料、`node_modules`、`.git`、`exports`、`.codex-remote-attachments`、使用者文件或 `_codex_archives`。不會刪除遠端分支、推送或部署。正式專案目前僅保留主要 Git Worktree。
