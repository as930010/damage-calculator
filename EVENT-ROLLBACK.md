# 共存節活動特效分支

`event/coexistence-moonlight` 保存活動限定的左上角月光呼吸效果與容器邊框光暈。效果集中在 `frontend/seasonal-effects.css`，只有此分支的 `index.html` 載入它。

活動結束時，從 GitHub Actions 的 Pages 工作流程選擇 `main` 並執行部署，即可發布目前主線的計算機版本而不含活動效果。主線以一般 revert 提交移除了效果，之後的計算模式、道具資料及 UI/UX 更新仍會留在主線；不要將主線重設到舊提交。活動期間若要取得主線的新功能，將 `main` 合併進此分支即可。此分支要部署時，需先推送分支、將 `event/coexistence-moonlight` 加入 `github-pages` 環境允許的部署分支，再從此分支手動執行 Pages 工作流程。若只想在活動分支本身停用效果，移除 `index.html` 的 `seasonal-effects.css` 連結即可。
