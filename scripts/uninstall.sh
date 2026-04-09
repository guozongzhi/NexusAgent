#!/usr/bin/env bash

# Nexus Agent — 卸载脚本（macOS / Linux / WSL）
#
# 等同于：
#   rm -f ~/.local/bin/nexus && rm -rf ~/.local/share/nexus

set -e

C_RESET="\033[0m" C_BOLD="\033[1m" C_DIM="\033[2m"
C_GREEN="\033[32m" C_YELLOW="\033[33m" C_CYAN="\033[36m"

ok()   { echo -e "${C_GREEN}${C_BOLD}✓${C_RESET} $1"; }
info() { echo -e "${C_CYAN}${C_BOLD}▸${C_RESET} $1"; }
warn() { echo -e "${C_YELLOW}${C_BOLD}!${C_RESET} $1"; }

echo ""
echo -e "${C_BOLD}Nexus Agent 卸载程序${C_RESET}"
echo -e "${C_DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo ""

# 1. 移除启动器
for f in "$HOME/.local/bin/nexus" "$HOME/.bun/bin/nexus"; do
  if [ -f "$f" ] || [ -L "$f" ]; then
    rm -f "$f"
    ok "已移除: $f"
  fi
done

# 2. 移除应用源码
NEXUS_SHARE="$HOME/.local/share/nexus"
if [ -d "$NEXUS_SHARE" ]; then
  rm -rf "$NEXUS_SHARE"
  ok "已移除: $NEXUS_SHARE"
else
  warn "应用目录不存在，跳过"
fi

# 3. 可选：清理配置
NEXUS_CONFIG="$HOME/.nexus"
if [ -d "$NEXUS_CONFIG" ]; then
  read -p "是否删除用户配置和历史记录 (~/.nexus)? [y/N]: " choice
  case "$choice" in
    [yY]|[yY][eE][sS])
      rm -rf "$NEXUS_CONFIG"
      ok "已移除: $NEXUS_CONFIG"
      ;;
    *)
      info "保留配置（重新安装时可继承）"
      ;;
  esac
fi

echo ""
echo -e "${C_DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
ok "Nexus Agent 已完全卸载"
echo ""
echo -e "  快速卸载命令（下次可直接用）:"
echo -e "  ${C_DIM}rm -f ~/.local/bin/nexus && rm -rf ~/.local/share/nexus${C_RESET}"
echo ""
