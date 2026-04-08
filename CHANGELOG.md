# Changelog

所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.1.0] - 2026-04-09

### 新增

- **ReAct 查询引擎** — 基于 OpenAI tool_call 的多轮推理循环
- **8 个内置工具** — bash, file_read, file_write, file_edit, list_dir, glob, grep, note
- **流式输出** — SSE 流式解析，逐字渲染
- **Ink 终端 UI** — React 编程模型的 CLI 界面
  - Welcome 欢迎界面 + 最近项目
  - Spinner 流式进度指示器
  - ToolPanel 工具调用可视化
  - PermissionPrompt 权限确认
  - StatusBar 底部状态栏
  - Onboarding 首次使用引导

### 安全

- 路径遍历防护 (Unicode NFC 规范化)
- 敏感文件写入保护 (.zshrc/.ssh/.gitconfig 等 8 类)
- 危险命令黑名单 (rm -rf /, fork 炸弹, mkfs 等)
- 文件写入大小限制 (10MB)
- 只读工具自动放行，写入工具需确认
- Always Allow 会话级自动放行

### 上下文管理

- MicroCompact — 零 API 成本清理旧 tool_result
- Full Compact — LLM 9 段式结构化摘要
- AutoCompact — 双层自动触发 (50%/80%) + 断路器
- Token 窗口截断 — 最终安全兜底

### 项目配置

- NEXUS.md 项目指令支持 (层级化加载)
- `~/.nexus/config.json` 持久化配置
- 环境变量 + 配置文件 + 命令行参数三级优先

### 命令系统

- `/help` — 帮助信息
- `/clear` — 清除会话
- `/config` — 动态配置
- `/model` — 切换模型
- `/status` — 运行状态
- `/history` — 会话统计
- `/compact` — 手动压缩

### 安装

- 一行安装: macOS/Linux (`curl | bash`) + Windows (`irm | iex`)
- 标准路径: `~/.local/bin/nexus` + `~/.local/share/nexus/`
- 内置命令: `nexus update` / `nexus doctor` / `nexus --version`
- 自动检测 Shell 类型 (zsh/bash/fish)
- 自动安装 Bun 运行时

### 测试

- 59 个测试用例 / 146 个断言
- 覆盖: 工具注册、安全防护、上下文压缩、Token 估算

### 文档

- README.md — 完整的开源项目文档
- ARCHITECTURE.md — 系统架构设计
- CONTRIBUTING.md — 贡献指南
- LICENSE — MIT 许可证
