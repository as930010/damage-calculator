[CmdletBinding()]
param([switch]$Execute,[switch]$ResidualOnly,[switch]$BuildOutputOnly)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Deliberately fixed allowlist. Do not add discovery under Temp here.
$script:ExpectedProject = 'C:\Users\user\Documents\ChatGPT\傷害計算機'
$script:ExpectedTemp = 'C:\Users\user\AppData\Local\Temp'
$script:Protected = @(
    "$script:ExpectedProject\.git", "$script:ExpectedProject\node_modules",
    "$script:ExpectedProject\frontend", "$script:ExpectedProject\scripts",
    "$script:ExpectedProject\tests", "$script:ExpectedProject\exports",
    "$script:ExpectedProject\.codex-remote-attachments",
    'C:\Users\user\Documents\ChatGPT\_codex_archives'
)
$script:Items = @()

function Normalize-Path([string]$Path) {
    [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}
function Test-SameOrChild([string]$Path, [string]$Parent) {
    $p = (Normalize-Path $Path) + '\'; $q = (Normalize-Path $Parent) + '\'
    return $p.StartsWith($q, [System.StringComparison]::OrdinalIgnoreCase) -or
        (Normalize-Path $Path).Equals((Normalize-Path $Parent), [System.StringComparison]::OrdinalIgnoreCase)
}
function Get-LinkTargetText($Item) {
    # LinkTarget exists on newer PowerShell/.NET. Windows PowerShell 5.1 cannot
    # reliably expose the target for every reparse tag; fail closed in that case.
    $prop = $Item.PSObject.Properties['Target']
    if (-not $prop) { $prop = $Item.PSObject.Properties['LinkTarget'] }
    if ($prop -and $prop.Value) { return (@($prop.Value) -join '; ') }
    return $null
}
function Resolve-LinkTargetPath($Link,[string]$TargetText) {
    if ([IO.Path]::IsPathRooted($TargetText)) { return [IO.Path]::GetFullPath($TargetText) }
    return [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $Link.FullName) $TargetText))
}
function Test-AllowedHiddenPath([string]$Path,[string[]]$AllowedHiddenPaths) {
    $full = Normalize-Path $Path
    foreach ($allowed in $AllowedHiddenPaths) {
        if ($full.Equals((Normalize-Path $allowed),[StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    return $false
}
function Get-AllowedStaleGitPointer([string]$Candidate) {
    $marker = Join-Path $Candidate '.git'
    if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return @() }
    $raw = Get-Content -LiteralPath $marker -Raw -ErrorAction SilentlyContinue
    if (-not $raw -or $raw -notmatch '(?im)^\s*gitdir:\s*(.+?)\s*$') { return @() }
    $targetText = $Matches[1].Trim()
    $gitDir = if ([IO.Path]::IsPathRooted($targetText)) { Normalize-Path $targetText } else { Normalize-Path (Join-Path $Candidate $targetText) }
    $worktreeMetadata = Normalize-Path (Join-Path $script:ExpectedProject '.git\worktrees')
    if ($gitDir.Equals($worktreeMetadata,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-SameOrChild $gitDir $worktreeMetadata)) { return @() }
    if (Test-Path -LiteralPath $gitDir) { return @() }
    $registered = @(& git -C $script:ExpectedProject worktree list --porcelain 2>$null)
    if ($LASTEXITCODE -ne 0) { return @() }
    $candidatePath = Normalize-Path $Candidate
    $isRegistered = @($registered | Where-Object { $_ -like 'worktree *' } | ForEach-Object { Normalize-Path ($_.Substring(9)) } | Where-Object { $_.Equals($candidatePath,[StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    if ($isRegistered) { return @() }
    return @($marker)
}
function Get-TreeInfo([string]$Path) {
    $state = [pscustomobject]@{ Bytes = [long]0; Files = [long]0; Directories = [long]0; Links = (New-Object System.Collections.ArrayList); Unsafe = (New-Object System.Collections.ArrayList); Signature = (New-Object System.Collections.ArrayList) }
    $stack = New-Object System.Collections.Stack
    $root = Get-Item -LiteralPath $Path -ErrorAction Stop
    if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [void]$state.Links.Add($root); return $state }
    [void]$stack.Push($root)
    while ($stack.Count) {
        $dir = $stack.Pop()
        [void]$state.Signature.Add(('{0}|{1}|{2}' -f $dir.FullName,$dir.LastWriteTimeUtc.Ticks,[int]$dir.Attributes))
        if (($dir.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System -bor [IO.FileAttributes]::ReadOnly)) -ne 0) { [void]$state.Unsafe.Add($dir.FullName) }
        foreach ($child in $dir.GetFileSystemInfos()) {
            [void]$state.Signature.Add(('{0}|{1}|{2}' -f $child.FullName,$child.LastWriteTimeUtc.Ticks,[int]$child.Attributes))
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                [void]$state.Signature.Add(('LINKTARGET|{0}|{1}' -f $child.FullName,(Get-LinkTargetText $child)))
                [void]$state.Links.Add($child)
                continue
            }
            if (($child.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System -bor [IO.FileAttributes]::ReadOnly)) -ne 0) { [void]$state.Unsafe.Add($child.FullName) }
            if (($child.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { $state.Directories++; [void]$stack.Push([IO.DirectoryInfo]$child) }
            else { $state.Files++; $state.Bytes += ([IO.FileInfo]$child).Length }
        }
    }
    return $state
}
function Format-Size([long]$Bytes) { '{0:N2} MiB ({1:N0} bytes)' -f ($Bytes / 1MB), $Bytes }
function Write-Log([string]$Message) {
    $line = "{0:yyyy-MM-dd HH:mm:ss zzz}`t{1}" -f (Get-Date), $Message
    Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
}
function Remove-TreeSafely([string]$Path,[string[]]$AllowedHiddenPaths = @()) {
    # Manual post-order traversal. Never enumerate through a reparse point.
    $root = Get-Item -LiteralPath $Path -ErrorAction Stop
    if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "候選根目錄本身是 Reparse Point，拒絕遞迴：$Path" }
    $dirs = New-Object System.Collections.Stack; $post = New-Object System.Collections.ArrayList
    [void]$dirs.Push($root)
    while ($dirs.Count) {
        $d = $dirs.Pop(); [void]$post.Add($d)
        $currentDir = Get-Item -LiteralPath $d.FullName -ErrorAction Stop
        if (($currentDir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "目錄變成 Reparse Point，停止：$($d.FullName)" }
        foreach ($c in $d.GetFileSystemInfos()) {
            if (($c.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            if (($c.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { [void]$dirs.Push([IO.DirectoryInfo]$c) }
        }
    }
    # Revalidate the entire item immediately before mutation.
    $fresh = Get-TreeInfo $Path
    $freshUnsafe = @($fresh.Unsafe | Where-Object { -not (Test-AllowedHiddenPath $_ $AllowedHiddenPaths) })
    if ($freshUnsafe.Count -or $fresh.Links.Count) { throw '重新檢查發現屬性或連結變化；停止此項。' }
    for ($i = $post.Count - 1; $i -ge 0; $i--) {
        $d = $post[$i]
        $currentDir = Get-Item -LiteralPath $d.FullName -ErrorAction Stop
        if (($currentDir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "目錄變成 Reparse Point，停止：$($d.FullName)" }
        foreach ($c in $d.GetFileSystemInfos()) {
            if (($c.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "清理期間新增 Reparse Point：$($c.FullName)" }
            if (($c.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System -bor [IO.FileAttributes]::ReadOnly)) -ne 0 -and -not (Test-AllowedHiddenPath $c.FullName $AllowedHiddenPaths)) { throw "隱藏、系統或唯讀項目阻擋清理：$($c.FullName)" }
            if (($c.Attributes -band [IO.FileAttributes]::Directory) -eq 0) { ([IO.FileInfo]$c).Delete() }
        }
        $d.Delete($false)
    }
}
function Remove-LinkSafely($Link, [string]$Candidate) {
    $linkPath = Normalize-Path $Link.FullName
    if (-not (Test-SameOrChild $linkPath $Candidate)) { throw "連結路徑超出白名單項目：$linkPath" }
    $fresh = Get-Item -LiteralPath $linkPath -ErrorAction Stop
    if (($fresh.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { throw "已不再是 Reparse Point：$linkPath" }
    $target = Get-LinkTargetText $fresh
    if (-not $target) { throw "此 PowerShell/檔案系統無法可靠取得連結目標，停止：$linkPath" }
    $targetPath = Resolve-LinkTargetPath $fresh $target
    $internalTarget = Test-SameOrChild $targetPath $Candidate
    $sharedModulesTarget = $targetPath.Equals((Normalize-Path (Join-Path $script:ExpectedProject 'node_modules')),[StringComparison]::OrdinalIgnoreCase)
    $targetExists = Test-Path -LiteralPath $targetPath
    if (-not $internalTarget -and -not $sharedModulesTarget) { throw "連結目標不在已知候選資料夾內，也不是已確認的正式 node_modules：$targetPath" }
    if (-not $targetExists -and -not $internalTarget) { throw "候選外連結目標不存在或不可讀：$targetPath" }
    Write-Host "解除連結本身：$linkPath -> $targetPath（目標存在：$targetExists）"
    # Directory.Delete on a reparse-point directory removes that entry, not its target.
    if ($fresh.PSIsContainer) { [IO.Directory]::Delete($linkPath, $false) } else { [IO.File]::Delete($linkPath) }
    if ($targetExists -and -not (Test-Path -LiteralPath $targetPath)) { throw "解除後目標未能確認仍存在：$targetPath" }
    if (-not $targetExists -and (Test-Path -LiteralPath $targetPath)) { throw "原先失效的連結目標狀態意外改變：$targetPath" }
    Write-Log "解除連結自身 $linkPath -> $targetPath；target-existed=$targetExists"
}
function Test-NoProcessReference([string]$Candidate) {
    # Detect command lines that explicitly reference a candidate (for example,
    # Chromium --user-data-dir). This cannot prove there are no open handles;
    # the operator must still close related apps before running cleanup.
    try { $processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop) }
    catch { throw "無法唯讀檢查執行程序，安全停止：$($_.Exception.Message)" }
    $matches = @($processes | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf($Candidate,[StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if ($matches.Count) {
        foreach ($process in $matches) { Write-Host "  使用中參照：PID $($process.ProcessId) $($process.Name) — $($process.CommandLine)" }
        return $false
    }
    return $true
}

$project = Normalize-Path (Split-Path -Parent $PSScriptRoot)
if (-not $project.Equals((Normalize-Path $script:ExpectedProject),[StringComparison]::OrdinalIgnoreCase)) { throw "專案位置不符，預期 $script:ExpectedProject，實際 $project；未進行任何操作。" }
if (-not (Normalize-Path $env:TEMP).Equals((Normalize-Path $script:ExpectedTemp),[StringComparison]::OrdinalIgnoreCase)) { throw "TEMP 位置不符預期 $script:ExpectedTemp；未進行任何操作。" }

function Add-Candidate([string]$Category,[string]$Path,[switch]$Optional) {
    $full = Normalize-Path $Path
    if (@($script:Items | Where-Object { $_.Path -eq $full }).Count) { throw "白名單重複：$full" }
    $script:Items += [pscustomobject]@{ Category=$Category; Path=$full; Optional=[bool]$Optional }
}
if ($ResidualOnly -and $BuildOutputOnly) { throw 'ResidualOnly 與 BuildOutputOnly 不能同時使用。' }
if ($ResidualOnly) {
    # Exact paths identified by the latest audit. This mode intentionally
    # excludes browser profiles, snapshots, dist, and every other candidate.
    Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-buff-release"
    Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-buff-ab-20261011"
    Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-mobile-ab-20261011"
} elseif ($BuildOutputOnly) {
    # Optional generated output, isolated from all Temp candidates.
    Add-Candidate 'E 可重建建置輸出' "$project\dist" -Optional
} else {
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\buff-ui-review-cdp"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\buff-ui-review-cdp2"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\buff-ui-review-cdp4"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\buff-ui-review-cdp5"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\buff-ui-review-design-pass6"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\buff-ui-review-pass7"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-cdp-check"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-cdp-integration"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-headless-diagnose"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-headless-mobile-final"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-integration-2"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-integration-3"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-history-invalid-baseline"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-toolbar-profile"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-toolbar-profile-2"
Add-Candidate 'A 瀏覽器測試 Profile' "$script:ExpectedTemp\dc-toolbar-profile-3"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-buff-release"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-buff-ab-20261011"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-mobile-ab-20261011"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-perf-chrome-20261011"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-perf-headless-20261011"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-perf-production-20261011"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-ui-mobile-profile"
Add-Candidate 'B UI、Buff、RWD、效能測試副本' "$script:ExpectedTemp\damage-calculator-ui-preview"
Add-Candidate 'C 舊 Worktree 實體副本' "$project\.codex-worktrees\mobile-rwd"
Add-Candidate 'C 舊 Worktree 實體副本' "$project\.codex-worktrees\perf-audit-20261011"
Add-Candidate 'C 舊 Worktree 實體副本' "$project\.codex-worktrees\perf-preview-restore-20261011"
Add-Candidate 'E 可重建建置輸出' "$project\dist" -Optional
}

foreach ($item in $script:Items) {
    foreach ($guard in $script:Protected) {
        if ((Test-SameOrChild $item.Path $guard) -or (Test-SameOrChild $guard $item.Path)) { throw "白名單與保護範圍重疊，安全停止：$($item.Path) / $guard" }
    }
    if ($item.Path -eq $project -or (Test-SameOrChild $project $item.Path)) { throw "候選項目是專案或其上層，拒絕：$($item.Path)" }
}

Write-Host "模式：$(if ($Execute) {'執行（仍需逐類及特殊項確認）'} else {'唯讀預覽'})$(if ($ResidualOnly) {'；僅列出三個已鑑識的殘留副本'} elseif ($BuildOutputOnly) {'；僅列出可重建 dist'} else {''})"
Write-Host "專案：$project | PowerShell $($PSVersionTable.PSVersion)"
$available = @()
foreach ($item in $script:Items) {
    if (-not (Test-Path -LiteralPath $item.Path -PathType Container)) { Write-Host "`n[$($item.Category)] 不存在：$($item.Path)"; continue }
    try {
        $info = Get-TreeInfo $item.Path
        $reasons = New-Object System.Collections.ArrayList
        $allowedHidden = @(Get-AllowedStaleGitPointer $item.Path)
        $unsafe = @($info.Unsafe | Where-Object { -not (Test-AllowedHiddenPath $_ $allowedHidden) })
        if ($unsafe.Count) { [void]$reasons.Add("含隱藏／系統／唯讀項目 $($unsafe.Count)") }
        if ($info.Links.Count) { [void]$reasons.Add("含 Reparse Point $($info.Links.Count)，須逐項確認") }
        $hasGit = Test-Path -LiteralPath (Join-Path $item.Path '.git')
        $gitIsAllowedStalePointer = ($allowedHidden.Count -eq 1)
        if ($hasGit -and -not $gitIsAllowedStalePointer) { [void]$reasons.Add('含未確認的 .git 資料；僅允許已驗證為失效且未登記的 worktree 指標檔') }
        $protectedContent = @($info.Signature | ForEach-Object { ($_ -split '\|',2)[0] } | Where-Object { $_ -match '(?i)\\(AGENTS\.md|[^\\]+\.xlsx|[^\\]+\.xls|[^\\]+\.docx|[^\\]+\.pdf)$' })
        if ($protectedContent.Count) { [void]$reasons.Add("疑似重要使用者文件 $($protectedContent.Count)") }
        $linkUnsafe = $false
        foreach ($link in $info.Links) {
            try {
                $target = Get-LinkTargetText $link
                if (-not $target) { throw '無法可靠取得目標' }
                $targetPath = Resolve-LinkTargetPath $link $target
                $internal = Test-SameOrChild $targetPath $item.Path
                $sharedModules = $targetPath.Equals((Normalize-Path (Join-Path $script:ExpectedProject 'node_modules')),[StringComparison]::OrdinalIgnoreCase)
                if (-not $internal -and -not $sharedModules) { throw "目標不在核准範圍：$targetPath" }
                if (-not (Test-Path -LiteralPath $targetPath) -and -not $internal) { throw "候選外目標不存在：$targetPath" }
            } catch { $linkUnsafe = $true; [void]$reasons.Add("連結未通過安全檢查：$($link.FullName)；$($_.Exception.Message)") }
        }
        $safe = ($unsafe.Count -eq 0 -and $protectedContent.Count -eq 0 -and (-not $hasGit -or $gitIsAllowedStalePointer) -and -not $linkUnsafe)
        Write-Host "`n[$($item.Category)] $($item.Path)"
        Write-Host "  檔案 $($info.Files)、一般資料夾 $($info.Directories)、大小 $(Format-Size $info.Bytes)；連結 $($info.Links.Count)；安全條件：$(if ($safe) {'符合（特殊項須另確認）'} else {'不符合，禁止清理'})$(if ($reasons.Count) {'；' + ($reasons -join '；')} else {''})$(if ($item.Optional) {'；選擇性，預設略過'} else {''})"
        foreach ($blocked in @($unsafe | Select-Object -First 5)) { Write-Host "  阻擋項目：$blocked" }
        if ($gitIsAllowedStalePointer) { Write-Host "  已驗證為失效且未登記的 worktree 指標檔：$($allowedHidden[0])；仍需逐項 DELETE-GIT" }
        elseif ($hasGit) { Write-Host "  Git 資料：$(Join-Path $item.Path '.git')（未通過失效指標檢查，禁止清理）" }
        foreach ($doc in $protectedContent) { Write-Host "  文件保護：$doc" }
        foreach ($link in $info.Links) { $t = Get-LinkTargetText $link; Write-Host "  REPARSE: $($link.FullName) -> $(if ($t) {$t} else {'無法可靠解析'})" }
        $available += [pscustomobject]@{ Item=$item; Info=$info; Safe=$safe; HasGit=$hasGit; AllowedHidden=$allowedHidden; Reasons=@($reasons) }
    } catch { Write-Host "`n[$($item.Category)] $($item.Path)`n  無法檢查：$($_.Exception.Message)；禁止清理" }
}
$total = [long]0
foreach ($record in ($available | Where-Object Safe)) { $total += $record.Info.Bytes }
Write-Host "`n符合初步條件的預計空間：$(Format-Size ([long]$total))。連結自身大小不計，且其目標絕不計入。"
if (-not $Execute) { Write-Host '預覽結束：沒有建立日誌或變更檔案。要進入確認流程請重新執行並加 -Execute。'; return }

$script:LogDir = Join-Path $env:LOCALAPPDATA 'DamageCalculatorCleanupLogs'
if ((Test-SameOrChild $script:LogDir $project) -or (Test-SameOrChild $project $script:LogDir)) { throw '日誌位置與專案重疊，停止。' }
New-Item -ItemType Directory -Path $script:LogDir -ErrorAction Stop | Out-Null
$script:LogFile = Join-Path $script:LogDir ('cleanup-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
New-Item -ItemType File -Path $script:LogFile -ErrorAction Stop | Out-Null
Write-Log "開始；專案=$project；PowerShell=$($PSVersionTable.PSVersion)"
$confirmed = @{}
foreach ($category in @('A 瀏覽器測試 Profile','B UI、Buff、RWD、效能測試副本','C 舊 Worktree 實體副本','D 舊 Snapshot','E 可重建建置輸出')) {
    $group = @($available | Where-Object { $_.Item.Category -eq $category -and $_.Safe -and (-not $_.Item.Optional -or $false) })
    if ($category -eq 'E 可重建建置輸出') { $group = @($available | Where-Object { $_.Item.Category -eq $category -and $_.Safe }) }
    if (-not $group.Count) { continue }
    $bytes = [long]0; foreach ($record in $group) { $bytes += $record.Info.Bytes }
    Write-Host "`n$category：$($group.Count) 項，$(Format-Size $bytes)"
    $group | ForEach-Object { Write-Host "  $($_.Item.Path)" }
    if ($category -eq 'E 可重建建置輸出') { $answer = Read-Host 'dist 預設不選；輸入 DELETE-E 才納入，其他輸入略過' }
    else { $answer = Read-Host "輸入 DELETE-$($category.Substring(0,1)) 才同意這一類，其他輸入取消此類" }
    $confirmed[$category] = if ($answer -ceq "DELETE-$($category.Substring(0,1))") { $true } else { $false }
}

foreach ($entry in $available) {
    $item = $entry.Item
    if (-not $entry.Safe -or -not $confirmed[$item.Category]) { Write-Log "略過 $($item.Path)：安全條件或類別確認未通過"; continue }
    try {
        if (-not (Test-NoProcessReference $item.Path)) { throw '程序命令列仍參照候選路徑；先關閉相關程序，之後重新預覽。' }
        $before = Get-TreeInfo $item.Path
        $oldSignature = @($entry.Info.Signature | Sort-Object)
        $newSignature = @($before.Signature | Sort-Object)
        if (($oldSignature -join "`n") -cne ($newSignature -join "`n")) { throw '自預覽後路徑內容或中繼資料改變，請重新預覽。' }
        if ($entry.HasGit) {
            $freshAllowedHidden = @(Get-AllowedStaleGitPointer $item.Path)
            if ($freshAllowedHidden.Count -ne 1 -or -not (Test-AllowedHiddenPath $freshAllowedHidden[0] $entry.AllowedHidden)) {
                throw '失效 .git 指標未能在刪除前再次驗證；停止此項。'
            }
        }
        if ($entry.HasGit -and (Read-Host "此項只有已驗證失效的 .git 指標檔。逐項輸入 DELETE-GIT 才移除此指標：$($item.Path)") -cne 'DELETE-GIT') { Write-Log "取消 $($item.Path)：Git 指標特殊確認未通過"; continue }
        # Gather approval for every reparse point before removing any of them;
        # declining one leaves this candidate completely untouched.
        $fresh = Get-TreeInfo $item.Path
        $linksApproved = $true
        $approvedLinks = New-Object System.Collections.ArrayList
        foreach ($link in $fresh.Links) {
            $target = Get-LinkTargetText $link
            if (-not $target) { throw "無法取得連結目標：$($link.FullName)" }
            Write-Host "`n特殊連結：$($link.FullName) -> $target"
            if ((Read-Host '逐項輸入 DELETE-LINK 才解除連結本身；其他輸入取消這個資料夾') -cne 'DELETE-LINK') { $linksApproved = $false; break }
            [void]$approvedLinks.Add($link)
        }
        if (-not $linksApproved) { Write-Log "取消 $($item.Path)：連結未同意"; continue }
        foreach ($link in $approvedLinks) { Remove-LinkSafely $link $item.Path }
        if (-not (Test-NoProcessReference $item.Path)) { throw '解除連結後發現程序命令列參照候選路徑；保留其餘資料並停止。' }
        $fresh = Get-TreeInfo $item.Path
        if ($fresh.Links.Count) { throw '仍有 Reparse Point，停止父目錄刪除。' }
        $freshUnsafe = @($fresh.Unsafe | Where-Object { -not (Test-AllowedHiddenPath $_ $entry.AllowedHidden) })
        if ($freshUnsafe.Count) { throw "含隱藏／系統／唯讀項目：$($freshUnsafe[0])" }
        Remove-TreeSafely $item.Path $entry.AllowedHidden
        Write-Host "成功：$($item.Path)"; Write-Log "成功 $($item.Path)"
    } catch { Write-Warning "失敗並停止此項：$($item.Path) — $($_.Exception.Message)"; Write-Log "失敗 $($item.Path)：$($_.Exception.Message)"; continue }
}
Write-Log '完成'
Write-Host "`n處理完成。日誌：$script:LogFile"
