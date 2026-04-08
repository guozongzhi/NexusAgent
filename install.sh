#!/usr/bin/env bash

# Nexus Agent — 跨平台安装脚本（macOS / Linux）
# 自动检测 Shell 类型、安装 Bun、挂载全局命令

set -e

# ─── 颜色 ─────────────────────────────────────────────────
C_RESET="\033[0m"
C_INFO="\033[1;36m"
C_OK="\033[1;32m"
C_ERR="\033[1;31m"
C_WARN="\033[1;33m"

info()  { echo -e "${C_INFO}► $1${C_RESET}"; }
ok()    { echo -e "${C_OK}✔ $1${C_RESET}"; }
warn()  { echo -e "${C_WARN}⚠ $1${C_RESET}"; }
err()   { echo -e "${C_ERR}✖ $1${C_RESET}"; }

# ─── 1. 操作系统检测 ──────────────────────────────────────
info "检测运行环境..."

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)  PLATFORM="macOS" ;;
  Linux)   PLATFORM="Linux" ;;
  MINGW*|MSYS*|CYGWIN*)
    err "检测到 Windows 环境，请使用 install.ps1 进行安装。"
    echo "  >> PowerShell 中执行: .\\install.ps1"
    exit 1
    ;;
  *)
    err "不支持的操作系统: $OS"
    exit 1
    ;;
esac

ok "系统: $PLATFORM ($ARCH)"

# ─── 2. Shell 类型检测 ────────────────────────────────────
CURRENT_SHELL="$(basename "$SHELL" 2>/dev/null || echo "unknown")"

# 确定 RC 文件
case "$CURRENT_SHELL" in
  zsh)   RC_FILE="$HOME/.zshrc" ;;
  bash)  
    # macOS 用 .bash_profile, Linux 用 .bashrc
    if [ "$PLATFORM" = "macOS" ]; then
      RC_FILE="$HOME/.bash_profile"
    else
      RC_FILE="$HOME/.bashrc"
    fi
    ;;
  fish)  RC_FILE="$HOME/.config/fish/config.fish" ;;
  *)     RC_FILE="$HOME/.profile" ;;
esac

ok "Shell: $CURRENT_SHELL → RC 文件: $RC_FILE"

# ─── 3. Bun 运行时检测与安装 ──────────────────────────────
info "检测 Bun 运行时..."

if ! command -v bun &> /dev/null; then
  # 尝试常见安装路径
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    ok "在 ~/.bun/bin 找到 Bun"
  else
    warn "未检测到 Bun，正在自动安装..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    
    if ! command -v bun &> /dev/null; then
      err "Bun 安装失败。请手动安装后重试: https://bun.sh"
      exit 1
    fi
    ok "Bun 安装成功"
  fi
else
  ok "Bun $(bun --version) 已就绪"
fi

# ─── 4. 依赖安装 ──────────────────────────────────────────
info "安装项目依赖..."

if bun install --frozen-lockfile 2>/dev/null; then
  ok "依赖安装完成"
else
  warn "frozen-lockfile 失败，尝试普通安装..."
  bun install
  ok "依赖安装完成（非锁定模式）"
fi

# ─── 5. 全局命令挂载 ──────────────────────────────────────
info "挂载全局命令 [nexus]..."

chmod +x ./src/main.tsx

BUN_BIN_DIR="$HOME/.bun/bin"
mkdir -p "$BUN_BIN_DIR"

# 清理旧链接
if [ -L "$BUN_BIN_DIR/nexus" ] || [ -f "$BUN_BIN_DIR/nexus" ]; then
  rm "$BUN_BIN_DIR/nexus"
fi

NEXUS_DIR="$(cd "$(dirname "$0")" && pwd)"
cat <<EOF > "$BUN_BIN_DIR/nexus"
#!/usr/bin/env bash
# Nexus Agent 启动器（由安装脚本生成）
exec bun run "$NEXUS_DIR/src/main.tsx" "\$@"
EOF

chmod +x "$BUN_BIN_DIR/nexus"
ok "全局命令 nexus 已挂载到 $BUN_BIN_DIR/nexus"

# ─── 6. PATH 环境变量注入 ─────────────────────────────────
if [ -f "$RC_FILE" ]; then
  if ! grep -q ".bun/bin" "$RC_FILE" 2>/dev/null; then
    info "正在将 Bun 路径注入 $RC_FILE..."

    case "$CURRENT_SHELL" in
      fish)
        echo 'set -gx PATH $HOME/.bun/bin $PATH' >> "$RC_FILE"
        ;;
      *)
        echo '' >> "$RC_FILE"
        echo '# Nexus Agent — Bun 运行时路径' >> "$RC_FILE"
        echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$RC_FILE"
        ;;
    esac
    ok "PATH 已注入 $RC_FILE"
  fi
else
  # RC 文件不存在，创建并写入
  case "$CURRENT_SHELL" in
    fish)
      mkdir -p "$(dirname "$RC_FILE")"
      echo 'set -gx PATH $HOME/.bun/bin $PATH' > "$RC_FILE"
      ;;
    *)
      echo 'export PATH="$HOME/.bun/bin:$PATH"' > "$RC_FILE"
      ;;
  esac
  ok "已创建 $RC_FILE 并注入 PATH"
fi

export PATH="$HOME/.bun/bin:$PATH"

# ─── 7. API Key 检测 ──────────────────────────────────────
echo ""
if [[ -z "$NEXUS_API_KEY" && -z "$OPENAI_API_KEY" ]]; then
  warn "未检测到 API Key 环境变量"
  echo "  启动前请执行:"
  echo "    export OPENAI_API_KEY=\"你的密钥\""
  echo "  或启动后使用: /config apiKey <密钥>"
else
  ok "API Key 环境变量已配置"
fi

# ─── 8. 完成 ──────────────────────────────────────────────
echo ""
echo "============================================="
echo -e "${C_OK}★ Nexus Agent 安装完成！${C_RESET}"
echo ""
echo "  使环境立即生效:"
case "$CURRENT_SHELL" in
  fish) echo -e "    ${C_INFO}source $RC_FILE${C_RESET}" ;;
  *)    echo -e "    ${C_INFO}source $RC_FILE${C_RESET}" ;;
esac
echo ""
echo "  启动 Nexus Agent:"
echo -e "    ${C_INFO}nexus${C_RESET}"
echo ""
echo "============================================="
