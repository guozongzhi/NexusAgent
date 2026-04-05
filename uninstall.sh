#!/usr/bin/env bash

# Nexus Agent - 安全卸载与清理脚本

set -e

COLOR_RESET="\033[0m"
COLOR_INFO="\033[1;36m"
COLOR_SUCCESS="\033[1;32m"
COLOR_WARN="\033[1;33m"

echo -e "${COLOR_INFO}► 开始卸载 Nexus Agent ...${COLOR_RESET}"

# 1. 自动尝试加载 PATH 兜底
if ! command -v bun &> /dev/null; then
    if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    fi
fi

# 2. 取消全局命令挂载
if [ -f "$HOME/.bun/bin/nexus" ]; then
    echo -e "${COLOR_INFO}► 正在取消系统中的全局 nexus 链接...${COLOR_RESET}"
    rm "$HOME/.bun/bin/nexus"
    echo -e "${COLOR_SUCCESS}✔ nexus 命令环境已移除${COLOR_RESET}"
else
    echo -e "${COLOR_WARN}⚠ 未检测到全局指令映射，跳过命令摘除。${COLOR_RESET}"
fi

# 3. 清理本地缓存机制
NEXUS_DATA_DIR="$HOME/.nexus"
if [ -d "$NEXUS_DATA_DIR" ]; then
    read -p "是否需要删除应用的历史记录和配置文件 ~/.nexus ? [y/N]: " del_data
    case "$del_data" in 
        [yY]|[yY][eE][sS])
            rm -rf "$NEXUS_DATA_DIR"
            echo -e "${COLOR_SUCCESS}✔ 历史记录与配置缓存已彻底粉碎。${COLOR_RESET}"
            ;;
        *)
            echo -e "${COLOR_INFO}ℹ 保留配置缓存，以便日后重新安装无缝继承。${COLOR_RESET}"
            ;;
    esac
fi

# 4. 可选删除 node_modules
if [ -d "./node_modules" ]; then
    read -p "是否需要清理当前目录下的 node_modules 依赖体 ? [y/N]: " del_mods
    case "$del_mods" in 
        [yY]|[yY][eE][sS])
            rm -rf ./node_modules
            echo -e "${COLOR_SUCCESS}✔ 本地依赖包已清除。${COLOR_RESET}"
            ;;
        *)
            ;;
    esac
fi

echo -e "\n============================================="
echo -e "${COLOR_SUCCESS}★ Nexus Agent 卸载流程已全部完成！期待下次再会。${COLOR_RESET}"
echo -e "============================================="
