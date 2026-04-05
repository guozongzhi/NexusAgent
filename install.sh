#!/usr/bin/env bash

# Nexus Agent - 自动化安装与启动配置脚本
# 该脚本用于检查环境、自动安全绑定全局命令并验证运行时准备情况。

set -e # 遇到错误即刻退出

COLOR_RESET="\033[0m"
COLOR_INFO="\033[1;36m"
COLOR_SUCCESS="\033[1;32m"
COLOR_ERROR="\033[1;31m"
COLOR_WARN="\033[1;33m"

echo -e "${COLOR_INFO}► 启动 Nexus Agent 智能终端安装指引...${COLOR_RESET}"

# 1. 环境检测: Bun 必须已安装
if ! command -v bun &> /dev/null; then
    # 兜底检查 ~/.bun/bin/bun
    if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    else
        echo -e "${COLOR_ERROR}✖ 严重错误: 无法在系统中定位到 Bun 运行时。${COLOR_RESET}"
        echo "  >> Nexus Agent 采用高度强化的 Bun 原生接口重构，依赖其并发模型。"
        echo "  >> 请先运行以下命令安装：curl -fsSL https://bun.sh/install | bash"
        exit 1
    fi
fi

echo -e "${COLOR_SUCCESS}✔ Bun 运行环境检测通过${COLOR_RESET}"

# 2. 依赖自动补全
echo -e "\n${COLOR_INFO}► 验证并安装核心依赖组...${COLOR_RESET}"
if ! NODE_TLS_REJECT_UNAUTHORIZED=0 bun install --frozen-lockfile; then
    echo -e "${COLOR_WARN}⚠ 触发网络或证书拦截，尝试切换回后备依赖解析器...${COLOR_RESET}"
    if command -v npm &> /dev/null; then
        npm install --strict-ssl=false
    else
        NODE_TLS_REJECT_UNAUTHORIZED=0 bun install
    fi
fi
echo -e "${COLOR_SUCCESS}✔ 依赖同步完成${COLOR_RESET}"

# 3. 拦截权限安全校验
chmod +x ./src/main.tsx

# 4. 执行核心命令挂载
echo -e "\n${COLOR_INFO}► 尝试挂载系统全局指令 [nexus]...${COLOR_RESET}"
BUN_BIN_DIR="$HOME/.bun/bin"
mkdir -p "$BUN_BIN_DIR"

# 必须先删除旧的占位符或软连，防止 `>` 符号穿透软链将内容写入到源码中！
if [ -L "$BUN_BIN_DIR/nexus" ] || [ -f "$BUN_BIN_DIR/nexus" ]; then
    rm "$BUN_BIN_DIR/nexus"
fi

NEXUS_DIR="$(pwd)"
cat << EOF > "$BUN_BIN_DIR/nexus"
#!/usr/bin/env bash
# 由 Nexus Agent 安装脚本自动挂载
exec bun run "$NEXUS_DIR/src/main.tsx" "\$@"
EOF

chmod +x "$BUN_BIN_DIR/nexus"
echo -e "${COLOR_SUCCESS}✔ 软连创建成功！全局指令 nexus 已硬性注入系统路径。${COLOR_RESET}"

# 5. 用户环境变量注入检查 (解决 zsh: command not found 问题)
ZSHRC_FILE="$HOME/.zshrc"
if [ -f "$ZSHRC_FILE" ]; then
    if ! grep -q "\.bun/bin" "$ZSHRC_FILE"; then
        echo -e "\n${COLOR_WARN}☁ 检测到您的 .zshrc 未包含 Bun 环境变量，正在帮您自动注入...${COLOR_RESET}"
        echo 'export PATH="$HOME/.bun/bin:$PATH"' >> "$ZSHRC_FILE"
        export PATH="$HOME/.bun/bin:$PATH"
        echo -e "${COLOR_SUCCESS}✔ 已成功在 ~/.zshrc 中注入 PATH。${COLOR_RESET}"
    fi
fi

# 6. 可用性自检
echo -e "\n${COLOR_INFO}► 执行预验：测试配置环境与连通性${COLOR_RESET}"

if [[ -z "$NEXUS_API_KEY" && -z "$OPENAI_API_KEY" ]]; then
    echo -e "${COLOR_WARN}⚠ 友情警告: 您尚未配置任何大语言模型的 API_KEY!${COLOR_RESET}"
    echo "  >> 系统依旧允许你打开 Agent，但将在 Query 提交时抛错触发中断。"
    echo "  >> 启动前请执行类似：export NEXUS_API_KEY=\"你的密钥\" "
    echo "  >> 或者启动后在系统内执行：/config apiKey <你的密钥>"
else
    echo -e "${COLOR_SUCCESS}✔ API 密钥检测发现环境存在鉴权凭证框架。${COLOR_RESET}"
fi

# 顺利结束
echo -e "\n============================================="
echo -e "${COLOR_SUCCESS}★ Nexus Agent 设施已全部部署完毕！${COLOR_RESET}"
echo -e "请在当前终端执行以下命令使环境立即生效：\n"
echo -e "  ➜  ${COLOR_INFO}source ~/.zshrc${COLOR_RESET}\n"
echo -e "生效后，敲击下方指令立刻开启智能终端：\n"
echo -e "  ➜  ${COLOR_INFO}nexus${COLOR_RESET}\n"
echo -e "============================================="
