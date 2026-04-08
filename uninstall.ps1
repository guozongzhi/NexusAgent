# Nexus Agent — Windows 卸载脚本 (PowerShell)
# 用法: .\uninstall.ps1

$ErrorActionPreference = "Stop"

function Write-Info  { param($msg) Write-Host "► $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "✔ $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }

Write-Info "开始卸载 Nexus Agent..."
Write-Host ""

# 1. 移除全局命令
$binDir = "$env:USERPROFILE\.bun\bin"
$removed = $false

foreach ($ext in @("nexus.cmd", "nexus.ps1", "nexus")) {
    $target = Join-Path $binDir $ext
    if (Test-Path $target) {
        Remove-Item $target -Force
        $removed = $true
    }
}

if ($removed) {
    Write-Ok "全局命令 nexus 已移除"
} else {
    Write-Warn "未检测到全局命令，跳过"
}

# 2. 清理配置
$nexusData = "$env:USERPROFILE\.nexus"
if (Test-Path $nexusData) {
    $choice = Read-Host "是否删除配置和历史记录 (~\.nexus)? [y/N]"
    if ($choice -match "^[yY]") {
        Remove-Item -Path $nexusData -Recurse -Force
        Write-Ok "配置和历史记录已删除"
    } else {
        Write-Info "保留配置（可重新安装时继承）"
    }
}

# 3. 清理 node_modules
if (Test-Path ".\node_modules") {
    $choice = Read-Host "是否删除 node_modules? [y/N]"
    if ($choice -match "^[yY]") {
        Remove-Item -Path ".\node_modules" -Recurse -Force
        Write-Ok "node_modules 已删除"
    }
}

Write-Host ""
Write-Host "============================================="
Write-Host "★ Nexus Agent 卸载完成！" -ForegroundColor Green
Write-Host "============================================="
