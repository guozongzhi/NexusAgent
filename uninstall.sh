#!/usr/bin/env bash

# Nexus Agent — 跨平台卸载脚本（macOS / Linux）

set -e

C_RESET="\033[0m"
C_INFO="\033[1;36m"
C_OK="\033[1;32m"
C_WARN="\033[1;33m"

info()  { echo -e "${C_INFO}► $1${C_RESET}"; }
ok()    { echo -e "${C_OK}✔ $1${C_RESET}"; }
warn()  { echo -e "${C_WARN}⚠ $1${C_RESET}"; }

info "开始卸载 Nexus Agent..."

# 1. PATH 兜底
if ! command -v bun &> /dev/null; then
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi
fi

# 2. 移除全局命令
if [ -f "$HOME/.bun/bin/nexus" ]; then
  info "移除全局命令 nexus..."
  rm "$HOME/.bun/bin/nexus"
  ok "nexus 命令已移除"
else
  warn "未检测到全局命令 nexus，跳过"
fi

# 3. 清理配置
NEXUS_DATA="$HOME/.nexus"
if [ -d "$NEXUS_DATA" ]; then
  read -p "是否删除配置和历史记录 (~/.nexus)? [y/N]: " del_data
  case "$del_data" in
    [yY]|[yY][eE][sS])
      rm -rf "$NEXUS_DATA"
      ok "配置和历史记录已删除"
      ;;
    *)
      info "保留配置（可重新安装时继承）"
      ;;
  esac
fi

# 4. 清理 node_modules
if [ -d "./node_modules" ]; then
  read -p "是否删除 node_modules? [y/N]: " del_mods
  case "$del_mods" in
    [yY]|[yY][eE][sS])
      rm -rf ./node_modules
      ok "node_modules 已删除"
      ;;
    *) ;;
  esac
fi

echo ""
echo "============================================="
echo -e "${C_OK}★ Nexus Agent 卸载完成！${C_RESET}"
echo "============================================="
