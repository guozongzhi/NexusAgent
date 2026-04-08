# Nexus Agent — Windows 安装脚本 (PowerShell)
# 用法: 在 PowerShell 中执行 .\install.ps1

$ErrorActionPreference = "Stop"

# ─── 颜色函数 ─────────────────────────────────────────────
function Write-Info  { param($msg) Write-Host "► $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "✔ $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Err   { param($msg) Write-Host "✖ $msg" -ForegroundColor Red }

Write-Info "Nexus Agent 安装程序 (Windows)"
Write-Host ""

# ─── 1. 检测 PowerShell 版本 ──────────────────────────────
$psVersion = $PSVersionTable.PSVersion.Major
if ($psVersion -lt 5) {
    Write-Err "需要 PowerShell 5.0 或更高版本 (当前: $psVersion)"
    exit 1
}
Write-Ok "PowerShell $($PSVersionTable.PSVersion) 已就绪"

# ─── 2. 检测/安装 Bun ─────────────────────────────────────
Write-Info "检测 Bun 运行时..."

$bunPath = "$env:USERPROFILE\.bun\bin"
$bunExe = "$bunPath\bun.exe"

$bunInPath = Get-Command bun -ErrorAction SilentlyContinue
if ($bunInPath) {
    Write-Ok "Bun $( & bun --version ) 已就绪"
} elseif (Test-Path $bunExe) {
    # 存在但不在 PATH 中
    $env:PATH = "$bunPath;$env:PATH"
    Write-Ok "在 $bunPath 找到 Bun"
} else {
    Write-Warn "未检测到 Bun，正在自动安装..."
    try {
        # 使用官方 Windows 安装脚本
        Invoke-RestMethod -Uri "https://bun.sh/install.ps1" | Invoke-Expression
        $env:PATH = "$bunPath;$env:PATH"
        
        if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
            Write-Err "Bun 安装失败。请手动安装: https://bun.sh/docs/installation"
            exit 1
        }
        Write-Ok "Bun 安装成功"
    } catch {
        Write-Err "Bun 安装失败: $_"
        Write-Host "请手动安装: https://bun.sh/docs/installation"
        exit 1
    }
}

# ─── 3. 安装依赖 ──────────────────────────────────────────
Write-Info "安装项目依赖..."

try {
    & bun install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) { throw "frozen-lockfile failed" }
    Write-Ok "依赖安装完成"
} catch {
    Write-Warn "frozen-lockfile 失败，尝试普通安装..."
    & bun install
    Write-Ok "依赖安装完成"
}

# ─── 4. 全局命令挂载 ──────────────────────────────────────
Write-Info "创建全局命令 [nexus]..."

$nexusDir = Split-Path -Parent $PSCommandPath
if (-not $nexusDir) { $nexusDir = (Get-Location).Path }

# 创建 .cmd 包装器（Windows 原生可执行）
$cmdContent = @"
@echo off
REM Nexus Agent 启动器（由安装脚本生成）
bun run "$nexusDir\src\main.tsx" %*
"@

# 创建 PowerShell 包装器
$ps1Content = @"
# Nexus Agent 启动器（由安装脚本生成）
& bun run "$nexusDir\src\main.tsx" @args
"@

# 写入到 Bun bin 目录
$targetDir = "$env:USERPROFILE\.bun\bin"
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Set-Content -Path "$targetDir\nexus.cmd" -Value $cmdContent -Encoding UTF8
Set-Content -Path "$targetDir\nexus.ps1" -Value $ps1Content -Encoding UTF8

Write-Ok "全局命令已创建:"
Write-Host "  → $targetDir\nexus.cmd (CMD)"
Write-Host "  → $targetDir\nexus.ps1 (PowerShell)"

# ─── 5. PATH 环境变量检测 ─────────────────────────────────
Write-Info "检测 PATH 配置..."

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*\.bun\bin*") {
    Write-Warn "Bun 路径未在用户 PATH 中，正在添加..."
    $newPath = "$bunPath;$userPath"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:PATH = "$bunPath;$env:PATH"
    Write-Ok "已将 $bunPath 添加到用户 PATH"
    Write-Warn "请重新打开终端窗口以使 PATH 生效"
} else {
    Write-Ok "PATH 已包含 Bun 路径"
}

# ─── 6. API Key 检测 ──────────────────────────────────────
Write-Host ""
$apiKey = $env:OPENAI_API_KEY
$nexusKey = $env:NEXUS_API_KEY

if (-not $apiKey -and -not $nexusKey) {
    Write-Warn "未检测到 API Key 环境变量"
    Write-Host '  启动前请执行:'
    Write-Host '    $env:OPENAI_API_KEY = "你的密钥"'
    Write-Host '  或使用系统环境变量:'
    Write-Host '    [Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "你的密钥", "User")'
} else {
    Write-Ok "API Key 环境变量已配置"
}

# ─── 7. 完成 ──────────────────────────────────────────────
Write-Host ""
Write-Host "============================================="
Write-Host "★ Nexus Agent 安装完成！" -ForegroundColor Green
Write-Host ""
Write-Host "  启动 Nexus Agent:"
Write-Host "    nexus" -ForegroundColor Cyan
Write-Host ""
Write-Host "  如果提示找不到命令，请重新打开终端窗口。"
Write-Host "============================================="
