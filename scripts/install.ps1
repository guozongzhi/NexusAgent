# Nexus Agent — 一键安装脚本 (Windows PowerShell)
#
# 用法：
#   irm https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/scripts/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://...install.ps1))) <version>
#
# 安装位置：
#   启动器：   ~\.local\bin\nexus.cmd / nexus.ps1
#   应用数据： ~\.local\share\nexus\
#   用户配置： ~\.nexus\

param(
    [string]$Version = "main"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ─── 配置 ─────────────────────────────────────────────────
$NexusRepo     = "https://github.com/guozongzhi/NexusAgent.git"
$NexusShareDir = "$env:USERPROFILE\.local\share\nexus"
$NexusBinDir   = "$env:USERPROFILE\.local\bin"

# ─── 颜色函数 ─────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "▸ " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Ok    { param($msg) Write-Host "✓ " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn  { param($msg) Write-Host "! " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Fail  { param($msg) Write-Host "✗ " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }

# ─── 主流程 ───────────────────────────────────────────────
Write-Host ""
Write-Host "Nexus Agent 安装程序" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host ""

# 1. 平台检测
$arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
Write-Ok "平台: Windows ($arch)"

# 2. Git 检查
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "需要 Git。请先安装: https://git-scm.com/downloads/win"
}
Write-Ok "Git $(git --version)"

# 3. Bun 检查/安装
$bunPath = "$env:USERPROFILE\.bun\bin"
$bunInPath = Get-Command bun -ErrorAction SilentlyContinue

if ($bunInPath) {
    Write-Ok "Bun $( & bun --version ) 已就绪"
} elseif (Test-Path "$bunPath\bun.exe") {
    $env:PATH = "$bunPath;$env:PATH"
    Write-Ok "Bun (在 $bunPath)"
} else {
    Write-Step "安装 Bun 运行时..."
    try {
        Invoke-RestMethod -Uri "https://bun.sh/install.ps1" | Invoke-Expression
        $env:PATH = "$bunPath;$env:PATH"
        if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
            throw "Bun 安装后仍未找到"
        }
        Write-Ok "Bun 安装成功"
    } catch {
        Write-Fail "Bun 安装失败: $_`n请手动安装: https://bun.sh"
    }
}

# 4. 下载/更新应用
New-Item -ItemType Directory -Path $NexusShareDir -Force | Out-Null
New-Item -ItemType Directory -Path $NexusBinDir -Force | Out-Null

if (Test-Path "$NexusShareDir\.git") {
    Write-Step "更新 Nexus Agent..."
    Push-Location $NexusShareDir
    & git fetch --quiet origin 2>$null
    & git pull --quiet origin $Version 2>$null
    Pop-Location
} else {
    Write-Step "下载 Nexus Agent ($Version)..."
    if (Test-Path $NexusShareDir) { Remove-Item -Path $NexusShareDir -Recurse -Force }
    & git clone --quiet --depth 1 $NexusRepo $NexusShareDir 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Git clone 失败。请检查网络连接。"
    }
}
Write-Ok "源码: $NexusShareDir"

# 5. 安装依赖
Write-Step "安装依赖..."
Push-Location $NexusShareDir
try {
    & bun install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) { & bun install }
} catch {
    & bun install
}
Pop-Location
Write-Ok "依赖安装完成"

# 6. 创建启动器
# CMD 启动器
$cmdLauncher = @"
@echo off
REM Nexus Agent 启动器

if "%1"=="--version" (
    cd /d "$NexusShareDir" && for /f "tokens=2 delims=:, " %%a in ('findstr "version" package.json') do echo Nexus Agent %%~a & exit /b
)
if "%1"=="update" (
    echo ▸ 更新 Nexus Agent...
    cd /d "$NexusShareDir" && git pull --quiet origin main && bun install --frozen-lockfile 2>nul || bun install
    echo ✓ 更新完成
    exit /b
)
if "%1"=="doctor" (
    echo Nexus Agent 环境诊断
    echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    echo 安装目录:  $NexusShareDir
    echo Bun:       && bun --version
    echo Git:       && git --version
    echo OS:        Windows %PROCESSOR_ARCHITECTURE%
    echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    exit /b
)

bun run "$NexusShareDir\src\main.tsx" %*
"@

# PowerShell 启动器
$ps1Launcher = @"
# Nexus Agent 启动器
`$NexusDir = "$NexusShareDir"

switch (`$args[0]) {
    '--version' {
        Push-Location `$NexusDir
        (Get-Content package.json | ConvertFrom-Json).version | ForEach-Object { "Nexus Agent v`$_" }
        Pop-Location
        return
    }
    '-v' {
        Push-Location `$NexusDir
        (Get-Content package.json | ConvertFrom-Json).version | ForEach-Object { "Nexus Agent v`$_" }
        Pop-Location
        return
    }
    'update' {
        Write-Host '▸ 更新 Nexus Agent...'
        Push-Location `$NexusDir
        & git pull --quiet origin main
        & bun install --frozen-lockfile 2>`$null
        if (`$LASTEXITCODE -ne 0) { & bun install }
        Pop-Location
        Write-Host '✓ 更新完成'
        return
    }
    'doctor' {
        Write-Host 'Nexus Agent 环境诊断'
        Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        Write-Host "安装目录:  `$NexusDir"
        Write-Host "Bun:       `$(bun --version 2>`$null)"
        Write-Host "Git:       `$(git --version 2>`$null)"
        Write-Host "OS:        Windows `$([Environment]::OSVersion.Version)"
        Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        return
    }
}

& bun run "`$NexusDir\src\main.tsx" @args
"@

Set-Content -Path "$NexusBinDir\nexus.cmd" -Value $cmdLauncher -Encoding UTF8
Set-Content -Path "$NexusBinDir\nexus.ps1" -Value $ps1Launcher -Encoding UTF8
Write-Ok "启动器: $NexusBinDir\nexus.cmd"

# 7. PATH 配置
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")

# ~/.local/bin
if ($userPath -notlike "*\.local\bin*") {
    [Environment]::SetEnvironmentVariable("Path", "$NexusBinDir;$userPath", "User")
    $env:PATH = "$NexusBinDir;$env:PATH"
    Write-Ok "已添加 $NexusBinDir 到 PATH"
}

# ~/.bun/bin
if ($userPath -notlike "*\.bun\bin*" -and (Test-Path $bunPath)) {
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    [Environment]::SetEnvironmentVariable("Path", "$bunPath;$currentPath", "User")
    $env:PATH = "$bunPath;$env:PATH"
}

Write-Ok "PATH 已配置"

# 8. API Key 检测
Write-Host ""
if (-not $env:OPENAI_API_KEY -and -not $env:NEXUS_API_KEY) {
    Write-Warn "API Key 未配置。启动前请执行:"
    Write-Host '  $env:OPENAI_API_KEY = "你的密钥"' -ForegroundColor DarkGray
} else {
    Write-Ok "API Key 已配置"
}

# 9. 完成
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
Write-Host "安装完成！" -ForegroundColor Green
Write-Host ""
Write-Host "  启动:    " -NoNewline; Write-Host "nexus" -ForegroundColor Cyan
Write-Host "  更新:    " -NoNewline; Write-Host "nexus update" -ForegroundColor Cyan
Write-Host "  诊断:    " -NoNewline; Write-Host "nexus doctor" -ForegroundColor Cyan
Write-Host "  版本:    " -NoNewline; Write-Host "nexus --version" -ForegroundColor Cyan
Write-Host "  卸载:    " -NoNewline; Write-Host 'Remove-Item ~\.local\bin\nexus.* -Force; Remove-Item ~\.local\share\nexus -Recurse -Force' -ForegroundColor DarkGray
Write-Host ""
Write-Host "  如果提示找不到命令，请重新打开终端窗口。" -ForegroundColor DarkGray
Write-Host ""
