# 資料模型與靜態資料結構

狀態：裝備資料、選項與效果映射，以及瀏覽器端計算流程已接入；部署前會檢查 JSON 結構與資料引用。所有職業及完整配裝組合仍未逐一完成數值比對。
資料更新日：2026-09-25（`260925`）  
部署架構：GitHub Pages、靜態 JSON、瀏覽器端計算、`localStorage`

## 1. 架構決策

本專案不設 API、伺服器、資料庫或 Admin UI，也不要求登入。網站從同一個 GitHub Pages 網域讀取公開 JSON；計算在瀏覽器執行。裝備與遊戲資料以 Git 儲存，提交紀錄作為修改歷程。使用者選擇的配裝／手動設定僅依先前決定存於本機 `localStorage`，不傳送到伺服器；不蒐集帳號或個人資料。

部署流程會檢查 JSON 是否可解析、屬性 key 是否存在、裝備目錄部位是否與映射相符，以及選項目錄引用是否有效。這些是結構與引用檢查，不會驗算遊戲數值或作為 Google Sheets 數值相同的證明；前端不得自行保存第二份裝備清單或屬性定義。

資料來源採 Google Sheets 線上內容為唯一最新基準。附件匯出檔只供輔助比對；公式、欄位或資料若與線上內容不一致，應回查 Google Sheets，並以其現行版本更新 JSON 與 Calculation Engine 規格。

## 2. 建議目錄

```text
data/
  manifest.json
  attributes.json
  slots.json
  classes.json
  class-combat-effects.json
  attack-parameters.json
  class-damage-passives.json
  parameters.json
  equipment/
    accessories.json
    magic-stones.json
    one-piece-costumes.json
    left-ice.json
    right-ice.json
    right-ice-set-effects.json
    innerwear.json
    circuits.json
    chips.json
    other-effects.json
calculation/
  types.ts
  class-effects.ts
  attack.ts
  probability.ts
  engine.ts
  attribute-aggregation.ts
  multiplicative.ts
  final-damage.ts
  index.ts
docs/
  data-model.md
package.json
pnpm-lock.yaml
tsconfig.json
```

資料檔直接代表目前官方同步套用的資料。更新時修改 JSON 並 Push，GitHub Pages 部署完成後，使用者載入最新資料。`manifest.json` 的日期欄位標示資料更新日，不提供遊戲版本選擇或歷史版本切換。Git 自然保留提交紀錄，但工具不提供回溯版本功能。

資料夾依目前試算表來源分類初步拆分。匯入前須逐欄對照各資料庫工作表，確認每種裝備實際欄位後才定稿，不預設所有裝備都有相同屬性欄位。

## 3. 共通資料原則

- 所有遊戲數值均以 JSON number 儲存，不把數字或百分比格式化成文字。
- `id` 是穩定、不重複的字串識別碼，不要求管理者維護數字 ID。`name` 是顯示名稱，可使用繁體中文；改名不應改變 `id`。
- 屬性以穩定的 `statKey` 對應 `attributes.json`，畫面顯示名稱由屬性目錄提供。不得以中文欄位名稱作為唯一計算鍵，以免更名影響公式。
- 每筆裝備資料至少有 `id`、`name`、`slotId`、`active`、`stats`、`effects`、`source`、`dataUpdatedAt`。部位相關數值分支使用 `targetApplications`，依實際套用目標保存各自來源屬性。
- 停用資料使用 `active: false`，不從歷史版本刪除。正式網站的選擇器預設只顯示啟用項目。
- `source` 記錄原始工作表與可取得的列／欄位置，便於追溯。未確認的來源位置留空並標示待補，不推測。

## 4. 遊戲資料檔案

### `manifest.json`

```json
{
  "schemaVersion": 1,
  "dataUpdatedAt": "2026-09-25",
  "displayDate": "260925",
  "sourceWorkbook": "DaB 9_23.xlsx",
  "notes": []
}
```

`dataUpdatedAt` 使用完整日期；`displayDate` 使用畫面顯示的六位日期。這是資料更新日期，不是可選擇的遊戲版本。來源檔名只是追溯資訊。

### `attributes.json`

定義可用屬性、顯示名稱、單位、數值聚合方式、上限及效果條件。聚合方式由計算規格決定，不由裝備名稱推斷。

```json
[
  {
    "key": "adaptability",
    "name": "適應力",
    "unit": "percent",
    "aggregation": "sum",
    "cap": { "value": 60, "scope": "characterTotal" },
    "active": true
  },
  {
    "key": "polarization",
    "name": "兩極化",
    "unit": "percent",
    "aggregation": "sum",
    "cap": { "value": 60, "scope": "characterTotal" },
    "active": true
  },
  {
    "key": "extremization",
    "name": "極大化",
    "unit": "percent",
    "aggregation": "sum",
    "active": true
  }
]
```

這三項必須是不同的 `key`。只有適應力與兩極化設定 60 上限，且上限作用於整個角色的屬性總值：合併角色固定值、所有裝備、兩套下衣的平均貢獻、Buff／Debuff 及其他已確認來源後才套用。不得只限制某件裝備或下衣來源。極大化不設定 60 屬性上限。其他屬性的上限與聚合方式，須依試算表實際公式逐項確認後填入。

### `slots.json`、`classes.json`、`parameters.json`

- `slots.json`：部位 ID、繁體中文名稱、排序、是否允許比較方案。部位清單依「裝備模擬區」實際位置整理。
- `simulator-equipment-mapping.json`：把「裝備模擬區」裝備與魔法石選擇格連到裝備目錄及「計算機」輸出列。右冰與飾品的項鍊各自使用 `necklace` 部位，避免和戒指或泛用飾品混在一起。
- `classes.json`：列出 60 個職業的穩定 ID、名稱、裝備限制及 `係數區` 已提供的物／魔職業係數（A2:C61）。職業戰鬥被動由 `class-combat-effects.json` 依職業 ID 提供。職業清單、係數及裝備選項皆由 JSON 載入，不硬編碼在前端或 Calculation Engine。新增大師聖獸列後，C154=1202 物攻、D154=1202 魔攻、H154=150 致命一擊傷害為所有職業共通固定值。致命一擊與極大化最終機率分別依 `計算機!B159`、`計算機!B160` 計算；B161/B162 是非遞減輸入，不是最終機率。
- `class-combat-effects.json`：每職業分開保存爆擊與極大化效果陣列，每筆包含在該職業／屬性陣列內唯一的效果 ID、計算方式、百分比值。引擎來源明細用職業 ID、屬性 key、效果 ID 組成完整來源鍵。`diminishing` 來源併入 F1/G1 後進遞減階梯；`multiplicative` 來源各自乘算；`nonDiminishing` 來源加總後分別對應 B161/B162 的計算階段。相同職業同一屬性的重複列必須保留成多筆效果，不能去重。
- `simulator-sources.ts`：集中解析裝備模擬選擇與既有各來源 resolver，按 shared、lowerwearA、lowerwearB 分組。前端只傳選取值；`calculateSimulatorLoadout` 再將解析結果送入獨立計算引擎。若電路板名稱沒有屬性映射，會回報欄位供 UI 顯示，不會猜測屬性。
- `attack-parameters.json`：逐職業保存物攻／魔攻職業係數，以及武器強化等級係數。C53 取物攻係數，D53 取魔攻係數；B32 武器強化等級對應 G2:H7 的 factor。
- `class-damage-passives.json`：保存職業被動爆傷百分點。DaB 為 30%，其餘職業依使用者指示暫設 0%；後續修改 JSON 即可更新。
- `parameters.json`：公式中使用的共通遊戲參數與資料來源。已確認的共通角色值為物攻 1202、魔攻 1202、致命一擊傷害 150、技能類雙攻 26.5；另含黃色聖獸精靈石爆擊／極大化倍率 +8%、T1 原始乘算暴傷 50% 及基準扣除 150%。技能類雙攻 26.5 直接來自 `計算機!V87` 常數；另外依選擇的巔峰選項套用 V36 修正。各職業的 B161 爆擊與 B162 極大非遞減值，及職業乘算來源，均由 `class-combat-effects.json` 依 JSON 規則彙總。
- `combat-rate-source-rules.json`：集中設定 B77、B103、B105 的致命一擊／極大化乘算來源。B77 僅在模擬區的聖獸精靈石顏色選黃時套用 8%，綠色為 0。B103 取 H12 下衣強化；B105 取 H39 鞋子強化。正式組與實驗組線上公式均引用各自模擬區的 H39。
- `master-beast-effects.json`：分開管理 E76 大師聖獸固定雙攻 +3%、B77 黃色聖獸精靈石爆擊／極大化乘算 +8%、S77 精靈石套裝傷害 +4%，以及 C78/D78/H78/I78/Q78 聖獸潛力數值。潛力不受精靈石顏色控制。

三種計算方式是每筆屬性效果的必要語意，未來可以有多個來源進入同一群：

- `diminishing`（遞減）：先彙入原始機率總值再進遞減階梯；F154 已包含於 F1，G154 已包含於 G1，不可重複加算。
- `multiplicative`（乘算）：對遞減階梯換算後的結果，逐項乘上 `(1 + value / 100)`。致命一擊目前 B77、B103；極大化目前 B77、B105。B77 只由黃色聖獸精靈石啟用；未來職業自身效果也可新增到同一群。
- `nonDiminishing`（非遞減）：所有乘算完成後才加到結果。致命一擊目前 B161；極大化依使用者定義為 B162。

來源儲存格只記在 `source` 追溯資訊；計算時由 stable key 及 `calculationMethod` 分群，不把儲存格位址當永久邏輯鍵。

職業設定至少須能區分「職業清單／職業係數」與「逐職業專屬參數是否齊備」，例如：

```json
{
  "id": "stable-class-key",
  "name": "試算表中的職業名稱",
  "active": true,
  "physicalCoefficient": null,
  "magicalCoefficient": null,
  "parameterSetId": "class-parameter-key-or-null",
  "calculationReady": false
}
```

`calculationReady` 應由載入資料中必填係數與職業專屬輸入是否完整決定；不可因使用者選到未設定職業而以預設 0 繼續計算。

### 裝備資料

每個裝備分類檔包含裝備陣列。裝備共同欄位如下：

```json
{
  "id": "example-stable-id",
  "name": "試算表中的繁體中文裝備名稱",
  "slotId": "slot-key-from-slots",
  "typeId": "type-key",
  "level": null,
  "active": true,
  "dataUpdatedAt": "2026-09-25",
  "stats": {
    "stat-key-from-attributes": 0
  },
  "effects": [],
  "source": {
    "sheet": "來源工作表名稱",
    "range": "待匯入時確認"
  },
  "updatedAt": "2026-09-25"
}
```

`level` 等來源中不存在或不適用的欄位可為 `null`，不得自行補值。額外效果以結構化資料表示，例如條件效果需保存效果屬性、觸發條件、數值及其計算方式；不可將公式藏在描述文字中。

若同一個可選項目因套用部位不同而有不同來源數值（例如魔法石），以 `targetApplications` 按 `armor`／`weapon` 等目標保存分支的來源名稱及 `stats`；不可先把部位數值混成單一總值。選擇器依實際裝備部位選擇目標分支，顯示並回傳該分支數值。

## 5. 下衣切換方案

角色配裝資料需將兩套互斥的下衣配置分開保存。每套配置可包含該配置實際適用的下衣、內裝下、電路、芯片、魔法石及相關效果。它們不是同時穿戴的額外裝備欄位。

一般數值依計算規格分別展開兩套配置的效果後平均，不能把兩套數值直接相加成同時裝備。強者與排熱保留為不同條件效果，並依已追蹤的計算機公式處理。現有公式的 50% 權重必須明確記在參數／效果規則中，不能散落於 UI。

新裝備若使用既有屬性與效果類型，可透過 JSON 更新資料。若新增的是計算引擎尚未實作的新效果類型，單改 JSON 無法定義其公式；前端應指出該效果未支援，不能默認使用加總或回報錯誤的最終傷害。

## 6. 瀏覽器配裝與 `localStorage`

目前使用者狀態以 `schemaVersion: 2` 儲存於瀏覽器 `localStorage`：

```json
{
  "schemaVersion": 2,
  "classId": "DaB",
  "values": { "D1": 0 },
  "lowerwearAlternativeEnabled": false,
  "masterBeastSpiritStoneColor": "黃",
  "petSkillAttackEnabled": true
}
```

狀態只存於目前瀏覽器來源的 `localStorage`，不送回伺服器，也不會在不同裝置或不同瀏覽器自動同步。工具列可匯出及匯入 JSON 配裝檔；目前匯出格式為 `format: "damage-calculator-loadout"`、`formatVersion: 2`，只包含目前配裝，不包含比較基準。裝備選擇以穩定內部 `id` 計算出的 32 位元數字代碼記錄；欄位仍以試算表儲存格位置識別，其他細部選項沿用原始選項值。代碼不依目錄排列順序；項目改名或數值更新但保留同一 `id` 時，匯入會使用目前資料；項目刪除、停用或代碼無法識別時，只清空該欄位並列出提示，其他有效欄位仍會載入。`formatVersion: 1` 的舊版名稱格式仍可匯入。部署檢查會偵測不同裝備 ID 的數字代碼碰撞，避免發佈後發生錯配。

## 7. 直接發布流程

1. 修改 `data/` 中目前使用的 JSON。
2. Push 至 GitHub，GitHub Pages 自動部署。
3. 部署完成後，前端載入最新 JSON，並顯示 `manifest.json` 的資料日期。

部署前執行 `pnpm run validate:data` 檢查 41 份 JSON、必填結構、TypeScript 資料型別合約、屬性 key、60 個職業資料引用、裝備／選項目錄引用及數字 ID 碰撞；再執行 `pnpm run test:transfer` 驗證匯出匯入往返、舊格式相容、已刪除裝備或下拉選項，以及損壞欄位的逐欄清空。檢查在建置流程執行，不加入使用者頁面的載入工作。這些檢查不執行遊戲公式驗算或完整數值比對。前端若遇到資料格式錯誤或載入失敗，應顯示讀取錯誤，不能把錯誤資料當成 0 繼續計算。Push 後會在 Pages 完成部署及瀏覽器取得新資料時套用更新，不保證提交瞬間所有使用者頁面同步刷新。

## 8. 尚待公式／欄位追蹤

首批已匯入飾品 39 筆、魔法石 7 種（合併防具／武器兩組來源列）、連身時裝 7 筆、左冰 9 筆、右冰 73 筆；右冰套效 24 筆亦已轉為屬性與件數條件。另建立 60 個職業、屬性、部位、共通參數及資料 manifest。裝備模擬區已識別的公式輸入與屬性輸出均已接線；沒有公式引用的輔助欄不會推定為效果：

魔法石第 2:8 列是防具值、第 9:15 列是武器值；已依使用者確認合併為一個選項，以 `targetApplications.armor`／`targetApplications.weapon` 保存來源名稱及數值。6 組有效屬性中，防具值皆為武器值一半；兩組「無關傷害」合併為一筆。

2026-09-26 已從「裝備模擬區」資料驗證規則匯出 73 組輸入範圍與其選項來源至 `data/simulator-input-options.json`。下拉選項已按「計算機」實際引用公式分派到資料目錄與計算器；玩家手動輸入欄位不會被誤做成下拉選項。
同期將「計算機」第 1:161 列共 157 個有內容列、917 個公式／列名儲存格及可辨認的跨表引用整理為 `docs/reference/calculation-source-map.json`。這是來源追蹤索引，不是執行公式或正式 JSON 資料；Google Sheets 專屬函式的匯出包裝與快取值不可直接當成計算規則。

- 目前不支援選擇「內裝本體」；保留未來新增裝備的可編輯資料結構，不虛構現有內裝項目。
- 「下衣」與「下衣2」為互斥替換配置。一般屬性照既定規則平均；強者%與排熱%保留兩份完整數值，分別套用 Boss 血量大於 50% 與小於等於 50% 的傷害條件，依計算機 B163 的調和式合併。此輸入規則記錄在 `data/simulator-input-rules.json`。
- 電路板項目與電路%數由玩家填寫，不使用係數區下拉選項硬限項目。
- 芯片屬性選項取 `係數區!P2:P8`，調校等級取 Q2:Q7。屬性數值由 R 欄「芯片調校屬性A」提供；只有「超越技傷%」、「Boss傷害%」改取 S 欄「芯片調校屬性B」。
- 依上述規則，7 種芯片選項及 +5 至 +10 數值已匯入 `data/equipment/chips.json`，並已接入五個內裝芯片位置及計算彙總。
- 「附魔」先前是未指向工作表欄位的模糊用詞，不代表魔法石、強化或鍛造。資料與 UI 一律沿用線上表格實際名稱「魔法石」、「強化」、「鍛造」、「電路板」、「電路%數」、「系統芯片」、「芯片調校」。
- 武器沒有鍛造欄位。武器成長只影響「所有技能傷害%」與「攻擊力等級」，對應 `計算機!L64`、`計算機!U64`。

- 內裝本體目前無可選項，預留未來擴充；內裝魔法石、強化、鍛造、電路板／電路%數、系統芯片／芯片調校均已接入計算來源。
- 武器等級、成長、一般魔力石，以及聖獸、賦靈錄、公會噴泉、襲擊套效和飾品鑑定等公式來源均已由 JSON 與計算模組接線。未來若新增尚無公式映射的 Buff／Debuff 或條件類型，須先確認表格公式。
- 武器變換 12 種效果選項已依 B42:B45 及計算機 54:57 公式建立 `weapon-transformations.json`；武器鑑定 A/B、巨型魔力石選項亦已建立獨立 JSON。其選項解析器可將效果轉成一般屬性來源。
- 計算機公式引用的「係數區」40 個範圍（484 個非空來源儲存格）已收錄於 `calculation-lookups.json`，保存公式、快取值及儲存格座標供後續逐項轉換。
- 消耗品、場地、稱號、公會噴泉與巔峰選項資料已整理至 `other-effect-options.json`；公會噴泉選項依計算機 F86:U88 公式對應至屬性。「適應靈藥」依使用者確認的計算機 Q82 公式增加適應力 +3。
- `simulator-input-options.json` 保存的 73 組資料驗證輸入均已分派到相應的裝備、效果或關卡控制；有公式效果者再依計算來源映射至最終屬性欄。
- 右冰套效資料中的 T 為門檻是否成立，U 為成立套效的序號，V 為套裝名稱，W 為已選件數；套效屬性值位於 B:S。24 筆效果已整理至 `right-ice-set-effects.json`，含 `exactly`／`atLeast` 件數門檻、屬性值及來源公式。使用者在 B27:B29 選擇最多三套，計算器只會按已裝備件數套用所選套裝目前符合的最高階效果；未選套裝不會觸發。
- 飾品鑑定選項依部位綁定至飾品欄位。`equipment/accessories.json` 每件飾品含 `appraisal.canAppraise` 與 `appraisal.effectCount`；`null` 表示來源尚未確認，這種狀態不會套用鑑定效果。更新資料時，確認可否鑑定及條數後即可決定顯示的選項數量。
- 試算表目前只有飾品上衣、臉中、臉下、手臂、項鍊、戒指 A／B 提供鑑定效果輸入與計算公式；武飾、臉上、耳環、支援、下衣目前沒有對應的鑑定計算欄位。這些部位可在目錄保存 `appraisal` 欄位，但若要讓它們參與計算，仍需先補上效果選項與公式映射。
- 各選項的職業限制、套裝門檻、Buff／Debuff 及其他條件效果的計算引用關係。
- 適應力、兩極化之外，各屬性的單位、上限、聚合方式及是否參與傷害公式。
- 前端 UI 與從使用者配裝狀態生成計算來源的轉換器已建立；所有職業／完整配裝組合尚未逐一與工作表快取做全面比對。

逐職業爆擊／極大效果已依使用者提供的表格轉成 `data/class-combat-effects.json`；重複被動以多筆陣列元素保留。OS 與 OZ 是同一職業的不同縮寫，統一映射至職業清單的正式代碼 `OZ`。其餘代碼使用職業清單的正式大小寫（DaB、CeT、DiA、BMa）。
