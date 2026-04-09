# Nexus Agent — 卸载脚本 (Windows PowerShell)
#
# 等同于：
#   Remove-Item ~\.local\bin\nexus.* -Force
#   Remove-Item ~\.local\share\nexus -Recurse -Force

$ErrorActionPreference = "Stop"

function Write-Ok   { param($msg) Write-Host "✓ " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Step { param($msg) Write-Host "▸ " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Warn { param($msg) Write-Host "! " -ForegroundColor Yellow -NoNewline; Write-Host $msg }

Write-Host ""
Write-Host "Nexus Agent 卸载程序" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""

# 1. 移除启动器
$binDir = "$env:USERPROFILE\.local\bin"
$oldBunDir = "$env:USERPROFILE\.bun\bin"

foreach ($dir in @($binDir, $oldBunDir)) {
    foreach ($ext in @("nexus.cmd", "nexus.ps1", "nexus")) {
        $target = Join-Path $dir $ext
        if (Test-Path $target) {
            Remove-Item $target -Force
            Write-Ok "已移除: $target"
        }
    }
}

# 2. 移除应用源码
$shareDir = "$env:USERPROFILE\.local\share\nexus"
if (Test-Path $shareDir) {
    Remove-Item -Path $shareDir -Recurse -Force
    Write-Ok "已移除: $shareDir"
} else {
    Write-Warn "应用目录不存在，跳过"
}

# 3. 可选：清理配置
$configDir = "$env:USERPROFILE\.nexus"
if (Test-Path $configDir) {
    $choice = Read-Host "是否删除用户配置和历史记录 (~\.nexus)? [y/N]"
    if ($choice -match "^[yY]") {
        Remove-Item -Path $configDir -Recurse -Force
        Write-Ok "已移除: $configDir"
    } else {
        Write-Step "保留配置（重新安装时可继承）"
    }
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Ok "Nexus Agent 已完全卸载"
Write-Host ""
Write-Host "  快速卸载命令（下次可直接用）:" -ForegroundColor DarkGray
Write-Host '  Remove-Item ~\.local\bin\nexus.* -Force; Remove-Item ~\.local\share\nexus -Recurse -Force' -ForegroundColor DarkGray
Write-Host ""
