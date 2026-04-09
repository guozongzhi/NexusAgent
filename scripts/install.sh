#!/usr/bin/env bash

# Nexus Agent — 一键安装脚本（macOS / Linux / WSL）
#
# 用法：
#   curl -fsSL https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/scripts/install.sh | bash
#   curl -fsSL ... | bash -s <version>    # 安装指定版本/分支
#
# 安装位置：
#   二进制：    ~/.local/bin/nexus
#   应用数据：  ~/.local/share/nexus/
#   用户配置：  ~/.nexus/

set -euo pipefail

# ─── 配置 ─────────────────────────────────────────────────
NEXUS_REPO="https://github.com/guozongzhi/NexusAgent.git"
NEXUS_SHARE_DIR="$HOME/.local/share/nexus"
NEXUS_BIN_DIR="$HOME/.local/bin"
NEXUS_BIN="$NEXUS_BIN_DIR/nexus"
NEXUS_VERSION="${1:-main}"   # 支持 bash -s <version>

# ─── 颜色 ─────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET="\033[0m"
  C_BOLD="\033[1m"
  C_DIM="\033[2m"
  C_GREEN="\033[32m"
  C_YELLOW="\033[33m"
  C_RED="\033[31m"
  C_CYAN="\033[36m"
else
  C_RESET="" C_BOLD="" C_DIM="" C_GREEN="" C_YELLOW="" C_RED="" C_CYAN=""
fi

info()  { echo -e "${C_CYAN}${C_BOLD}▸${C_RESET} $1"; }
ok()    { echo -e "${C_GREEN}${C_BOLD}✓${C_RESET} $1"; }
warn()  { echo -e "${C_YELLOW}${C_BOLD}!${C_RESET} $1"; }
fail()  { echo -e "${C_RED}${C_BOLD}✗${C_RESET} $1"; exit 1; }

# ─── 1. 平台检测 ──────────────────────────────────────────
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)        PLATFORM="macOS" ;;
    Linux)         PLATFORM="Linux" ;;
    MINGW*|MSYS*)  fail "检测到 Windows 环境。请使用 PowerShell 安装：irm https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/scripts/install.ps1 | iex" ;;
    *)             fail "不支持的操作系统: $os" ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             ARCH="$arch" ;;
  esac
}

# ─── 2. Shell 检测 ────────────────────────────────────────
detect_shell() {
  CURRENT_SHELL="$(basename "${SHELL:-/bin/bash}")"
  case "$CURRENT_SHELL" in
    zsh)
      RC_FILE="$HOME/.zshrc"
      ;;
    bash)
      if [ "$PLATFORM" = "macOS" ]; then
        RC_FILE="$HOME/.bash_profile"
      else
        RC_FILE="$HOME/.bashrc"
      fi
      ;;
    fish)
      RC_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/fish/config.fish"
      ;;
    *)
      RC_FILE="$HOME/.profile"
      ;;
  esac
}

# ─── 3. 依赖检查 ──────────────────────────────────────────
check_dependencies() {
  # Git 必须存在
  if ! command -v git &>/dev/null; then
    fail "需要 Git。请先安装：\n  macOS: xcode-select --install\n  Linux: sudo apt install git"
  fi

  # Bun：检查或自动安装
  if ! command -v bun &>/dev/null; then
    if [ -f "$HOME/.bun/bin/bun" ]; then
      export PATH="$HOME/.bun/bin:$PATH"
    else
      info "安装 Bun 运行时..."
      curl -fsSL https://bun.sh/install | bash 2>/dev/null
      export PATH="$HOME/.bun/bin:$PATH"
      if ! command -v bun &>/dev/null; then
        fail "Bun 安装失败。请手动安装：https://bun.sh"
      fi
    fi
  fi
}

# ─── 4. 下载/更新应用 ─────────────────────────────────────
install_app() {
  mkdir -p "$NEXUS_SHARE_DIR"
  mkdir -p "$NEXUS_BIN_DIR"

  if [ -d "$NEXUS_SHARE_DIR/.git" ]; then
    # 已存在 → 更新
    info "更新 Nexus Agent..."
    (cd "$NEXUS_SHARE_DIR" && git fetch --quiet origin && git checkout --quiet "$NEXUS_VERSION" && git pull --quiet origin "$NEXUS_VERSION" 2>/dev/null || true)
  else
    # 首次安装 → 克隆
    info "下载 Nexus Agent ($NEXUS_VERSION)..."
    rm -rf "$NEXUS_SHARE_DIR"
    git clone --quiet --depth 1 --branch "$NEXUS_VERSION" "$NEXUS_REPO" "$NEXUS_SHARE_DIR" 2>/dev/null || \
    git clone --quiet --depth 1 "$NEXUS_REPO" "$NEXUS_SHARE_DIR"
  fi
}

# ─── 5. 安装依赖 ──────────────────────────────────────────
install_dependencies() {
  info "安装项目依赖..."
  (cd "$NEXUS_SHARE_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install) >/dev/null
}

# ─── 6. 创建启动器 ────────────────────────────────────────
create_launcher() {
  # 移除旧启动器
  rm -f "$NEXUS_BIN" "$HOME/.bun/bin/nexus"

  cat > "$NEXUS_BIN" <<'LAUNCHER'
#!/usr/bin/env bash
# Nexus Agent 启动器（由安装脚本生成）
set -e

NEXUS_DIR="$HOME/.local/share/nexus"

# 确保 Bun 在 PATH 中
if ! command -v bun &>/dev/null; then
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    echo "错误: 未找到 Bun 运行时。请运行: curl -fsSL https://bun.sh/install | bash" >&2
    exit 1
  fi
fi

# 内置命令
case "${1:-}" in
  --version|-v)
    cd "$NEXUS_DIR" && grep '"version"' package.json | head -1 | sed 's/.*: *"\(.*\)".*/Nexus Agent v\1/'
    exit 0
    ;;
  update)
    echo "▸ 更新 Nexus Agent..."
    cd "$NEXUS_DIR" && git pull --quiet origin main && bun install --frozen-lockfile 2>/dev/null || bun install
    echo "✓ 更新完成"
    exit 0
    ;;
  doctor)
    echo "Nexus Agent 环境诊断"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "安装目录:  $NEXUS_DIR"
    echo "启动器:    $(realpath "$0" 2>/dev/null || echo "$0")"
    echo "Bun:       $(bun --version 2>/dev/null || echo '未找到')"
    echo "Git:       $(git --version 2>/dev/null || echo '未找到')"
    echo "Node.js:   $(node --version 2>/dev/null || echo '未安装')"
    echo "Shell:     $SHELL"
    echo "OS:        $(uname -s) $(uname -m)"

    # 检查版本
    if [ -d "$NEXUS_DIR/.git" ]; then
      cd "$NEXUS_DIR"
      echo "版本:      $(grep '"version"' package.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')"
      echo "分支:      $(git branch --show-current 2>/dev/null || echo 'detached')"
      echo "最新提交:  $(git log -1 --format='%h %s' 2>/dev/null || echo '未知')"
    fi

    # 检查 API Key
    if [ -n "${OPENAI_API_KEY:-}" ] || [ -n "${NEXUS_API_KEY:-}" ]; then
      echo "API Key:   ✓ 已配置"
    else
      echo "API Key:   ✗ 未配置"
    fi
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 0
    ;;
esac

exec bun run "$NEXUS_DIR/src/main.tsx" "$@"
LAUNCHER

  chmod +x "$NEXUS_BIN"
}

# ─── 7. PATH 配置 ─────────────────────────────────────────
ensure_path() {
  # 检查 ~/.local/bin 是否在 PATH 中
  case ":$PATH:" in
    *":$NEXUS_BIN_DIR:"*) return ;;
  esac

  # 需要注入 PATH
  local path_line
  case "$CURRENT_SHELL" in
    fish)
      path_line="fish_add_path $NEXUS_BIN_DIR"
      ;;
    *)
      path_line='export PATH="$HOME/.local/bin:$PATH"'
      ;;
  esac

  if [ -f "$RC_FILE" ]; then
    if ! grep -q ".local/bin" "$RC_FILE" 2>/dev/null; then
      echo "" >> "$RC_FILE"
      echo "# Nexus Agent" >> "$RC_FILE"
      echo "$path_line" >> "$RC_FILE"
    fi
  else
    mkdir -p "$(dirname "$RC_FILE")"
    echo "$path_line" > "$RC_FILE"
  fi

  export PATH="$NEXUS_BIN_DIR:$PATH"
}

# ─── 8. Bun PATH 配置 ────────────────────────────────────
ensure_bun_path() {
  if [ -d "$HOME/.bun/bin" ]; then
    case "$CURRENT_SHELL" in
      fish)
        local bun_line="fish_add_path $HOME/.bun/bin"
        ;;
      *)
        local bun_line='export PATH="$HOME/.bun/bin:$PATH"'
        ;;
    esac

    if [ -f "$RC_FILE" ] && ! grep -q ".bun/bin" "$RC_FILE" 2>/dev/null; then
      echo "$bun_line" >> "$RC_FILE"
    fi
  fi
}

# ─── 主流程 ───────────────────────────────────────────────
main() {
  echo ""
  echo -e "${C_BOLD}Nexus Agent 安装程序${C_RESET}"
  echo -e "${C_DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
  echo ""

  detect_platform
  ok "平台: $PLATFORM ($ARCH)"

  detect_shell
  ok "Shell: $CURRENT_SHELL → $RC_FILE"

  check_dependencies
  ok "Bun $(bun --version) 已就绪"

  install_app
  ok "源码已下载到 $NEXUS_SHARE_DIR"

  install_dependencies
  ok "依赖安装完成"

  create_launcher
  ok "启动器: $NEXUS_BIN"

  ensure_path
  ensure_bun_path
  ok "PATH 已配置"

  # API Key 提示
  echo ""
  if [ -z "${OPENAI_API_KEY:-}" ] && [ -z "${NEXUS_API_KEY:-}" ]; then
    warn "API Key 未配置。启动前请执行:"
    echo -e "  ${C_DIM}export OPENAI_API_KEY=\"你的密钥\"${C_RESET}"
  else
    ok "API Key 已配置"
  fi

  echo ""
  echo -e "${C_DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
  echo -e "${C_GREEN}${C_BOLD}安装完成！${C_RESET}"
  echo ""
  echo -e "  使环境生效:  ${C_CYAN}source $RC_FILE${C_RESET}"
  echo -e "  启动:        ${C_CYAN}nexus${C_RESET}"
  echo -e "  更新:        ${C_CYAN}nexus update${C_RESET}"
  echo -e "  诊断:        ${C_CYAN}nexus doctor${C_RESET}"
  echo -e "  版本:        ${C_CYAN}nexus --version${C_RESET}"
  echo -e "  卸载:        ${C_CYAN}rm -f ~/.local/bin/nexus && rm -rf ~/.local/share/nexus${C_RESET}"
  echo ""
}

main "$@"
