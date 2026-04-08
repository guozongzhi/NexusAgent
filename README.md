<p align="center">
  <h1 align="center">Nexus Agent</h1>
  <p align="center">
    <strong>基于 ReAct 范式的本地命令行 AI 编程助手</strong>
  </p>
  <p align="center">
    <a href="#快速开始">快速开始</a> •
    <a href="#功能特性">功能特性</a> •
    <a href="#架构设计">架构</a> •
    <a href="#命令参考">命令</a> •
    <a href="#贡献指南">贡献</a>
  </p>
</p>

---

Nexus Agent 是一个运行在终端中的智能编程助手。它理解你的代码库，通过自然语言指令执行文件操作、代码搜索、Shell 命令等任务——直接在你的本地环境中行动，而不是仅仅给出建议。

```
$ nexus
┌─────────────────────────────────────────────────────────────┐
│  Nexus Agent v0.1.0                                         │
│  Model: gpt-4o · Context: 128k                              │
│  cwd: ~/projects/my-app                                     │
└─────────────────────────────────────────────────────────────┘

> 帮我重构 src/utils 下的所有工具函数，添加 JSDoc 注释

  ▸ 读取 src/utils/ 目录...
  ▸ 分析 5 个文件...
  ▸ 编辑 src/utils/format.ts — 添加 JSDoc
  ▸ 编辑 src/utils/path.ts — 添加 JSDoc
  ✓ 已完成 5 个文件的重构
```

## 快速开始

### 系统要求

| 要求 | 最低版本 |
|------|---------|
| 操作系统 | macOS 12+, Ubuntu 20.04+, Windows 10 1809+ |
| 运行时 | [Bun](https://bun.sh) 1.0+ (安装脚本自动安装) |
| 硬件 | 4 GB+ RAM, x64 或 ARM64 |
| 网络 | 需要互联网连接 (调用 LLM API) |

### 安装

**macOS / Linux (推荐):**

```bash
curl -fsSL https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/install.ps1 | iex
```

**从源码安装:**

```bash
git clone https://github.com/guozongzhi/NexusAgent.git
cd NexusAgent
bash install.sh
```

### 配置

启动前设置 LLM API Key：

```bash
export OPENAI_API_KEY="sk-..."
```

或启动后使用内置命令：

```
/config apiKey sk-...
```

支持任何 OpenAI 兼容 API（Ollama、vLLM、LiteLLM 等）：

```bash
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"
```

### 启动

```bash
nexus
```

## 功能特性

### 🔧 工具系统

Nexus Agent 通过 ReAct (Reasoning + Acting) 范式驱动工具调用：

| 工具 | 描述 | 权限 |
|------|------|------|
| `bash` | 执行 Shell 命令 | 🔒 需确认 |
| `file_read` | 读取文件内容 (支持行范围) | ✅ 只读 |
| `file_write` | 创建或覆盖文件 | 🔒 需确认 |
| `file_edit` | 精确编辑 (old_string → new_string) | 🔒 需确认 |
| `list_dir` | 列出目录 (支持递归/树形) | ✅ 只读 |
| `glob` | 按模式搜索文件路径 | ✅ 只读 |
| `grep` | 按正则搜索文件内容 | ✅ 只读 |
| `note` | 记录思考笔记 (不执行操作) | ✅ 只读 |

### 🧠 上下文压缩

参考 Claude Code 的多层压缩架构，自动管理 token 窗口：

```
                    ┌─────────────────────────────────┐
                    │        Token 窗口检测             │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────────────────┐
          > 50%     │      MicroCompact               │ ← 零 API 成本
                    │  清理旧 tool_result 内容          │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────────────────┐
          > 80%     │      Full Compact               │ ← LLM 摘要
                    │  9 段式结构化上下文压缩            │
                    └──────────┬──────────────────────┘
                               │
                    ┌──────────▼──────────────────────┐
          Fallback  │      Truncate                   │ ← 安全截断
                    │  保留最新消息，丢弃最旧            │
                    └─────────────────────────────────┘
```

### 🔒 安全机制

- **路径遍历防护** — 所有文件操作限制在工作目录内
- **Unicode NFC 规范化** — 防止标准化攻击绕过
- **敏感文件保护** — 禁止修改 `.zshrc` / `.ssh/` / `.gitconfig` 等
- **危险命令黑名单** — 拦截 `rm -rf /` / fork 炸弹 / `mkfs` 等
- **文件大小限制** — 写入上限 10MB
- **权限确认** — 写入操作需用户确认，支持 `Always Allow`

### 📋 项目指令 (NEXUS.md)

在项目根目录创建 `NEXUS.md` 文件来定义项目级别的 AI 行为规范：

```markdown
# 项目规范

- 所有代码使用 TypeScript 严格模式
- 使用 Bun 作为运行时
- 测试使用 bun:test
- 提交信息使用 Conventional Commits
```

支持层级化加载：从 `~/.nexus/NEXUS.md` (全局) 到项目目录 (就近优先)。

## 命令参考

### 内置命令

| 命令 | 描述 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清除会话历史和屏幕 |
| `/config <key> <value>` | 动态修改配置 |
| `/model <name>` | 切换 LLM 模型 |
| `/status` | 显示连接状态、模型、token 用量 |
| `/history` | 查看会话消息数和 token 估算 |
| `/compact` | 手动触发上下文压缩 |
| `/exit` | 退出应用 |

### CLI 命令

```bash
nexus                 # 启动交互式会话
nexus --version       # 显示版本号
nexus update          # 更新到最新版本
nexus doctor          # 运行环境诊断
```

## 架构设计

详见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

```
nexus-agent/
├── src/
│   ├── main.tsx              # 应用入口 + Ink UI 主循环
│   ├── QueryEngine.ts        # ReAct 查询引擎 (流式 + tool_call 循环)
│   ├── Tool.ts               # 工具注册表
│   ├── context.ts            # System Prompt 构建
│   ├── config.ts             # 配置加载/持久化
│   ├── commands/
│   │   └── router.ts         # 内置命令路由器
│   ├── components/           # Ink (React) 终端 UI 组件
│   │   ├── Welcome.tsx       # 欢迎界面
│   │   ├── StatusBar.tsx     # 底部状态栏
│   │   ├── Spinner.tsx       # 流式进度指示器
│   │   ├── ToolPanel.tsx     # 工具调用面板
│   │   ├── PermissionPrompt  # 权限确认
│   │   └── Onboarding.tsx    # 首次使用引导
│   ├── tools/                # 工具实现
│   │   ├── BashTool.ts
│   │   ├── FileReadTool.ts
│   │   ├── FileWriteTool.ts
│   │   ├── FileEditTool.ts
│   │   ├── GlobTool.ts
│   │   ├── GrepTool.ts
│   │   ├── ListDirTool.ts
│   │   └── NoteTool.ts
│   ├── services/
│   │   ├── api/              # LLM 适配层
│   │   ├── compact/          # 上下文压缩服务
│   │   ├── history/          # 会话管理 + Token 窗口
│   │   └── projectConfig.ts  # NEXUS.md 加载
│   ├── security/
│   │   └── pathGuard.ts      # 路径安全 + 命令黑名单
│   ├── types/
│   │   └── index.ts          # 核心类型定义
│   └── utils/                # 工具函数
├── tests/                    # 测试套件
├── install.sh                # macOS/Linux 安装
├── install.ps1               # Windows 安装
└── ARCHITECTURE.md           # 架构设计文档
```

## 配置

配置文件位于 `~/.nexus/config.json`：

```json
{
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-..."
}
```

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | — |
| `OPENAI_BASE_URL` | API 基础 URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 默认模型 | `gpt-4o` |
| `NEXUS_API_KEY` | 兼容的 API 密钥别名 | — |

## 开发

### 环境搭建

```bash
git clone https://github.com/guozongzhi/NexusAgent.git
cd NexusAgent
bun install
```

### 常用命令

```bash
bun run dev          # 启动开发模式
bun test             # 运行测试套件
bun run typecheck    # TypeScript 类型检查
```

### 测试

```bash
$ bun test

 59 pass
 0 fail
 146 expect() calls
Ran 59 tests across 4 files. [36ms]
```

测试覆盖：
- `tests/core.test.ts` — 工具注册、函数定义、路径工具
- `tests/security.test.ts` — 路径防护、命令黑名单、文件大小、敏感文件
- `tests/compact.test.ts` — MicroCompact、Prompt 模板、Token 估算
- `tests/tokenWindow.test.ts` — Token 估算、消息截断

## 贡献指南

详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交变更 (`git commit -m 'feat: add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 发起 Pull Request

### 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat:     新功能
fix:      修复 Bug
refactor: 重构（不改变功能）
docs:     文档更新
test:     测试更新
chore:    构建/工具链更新
```

## 技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 运行时 | [Bun](https://bun.sh) | 高性能 JS/TS 运行时 |
| 语言 | TypeScript (Strict) | 类型安全 |
| UI | [Ink](https://github.com/vadimdemedes/ink) + React | 终端 UI 框架 |
| CLI | [Commander.js](https://github.com/tj/commander.js) | CLI 参数解析 |
| 验证 | [Zod](https://github.com/colinhacks/zod) | 运行时 Schema 验证 |
| LLM | [OpenAI SDK](https://github.com/openai/openai-node) | LLM API 客户端 |

## 路线图

- [x] ReAct 查询引擎 + 流式输出
- [x] 8 个核心工具
- [x] 权限确认 + Always Allow
- [x] 上下文压缩 (MicroCompact + Full Compact)
- [x] NEXUS.md 项目指令
- [x] 跨平台安装 (macOS/Linux/Windows)
- [ ] Session Memory (增量式记忆提取)
- [ ] AgentTool (子代理分发)
- [ ] MCP 协议支持
- [ ] IDE 集成 (VS Code / JetBrains)
- [ ] `nexus init` 项目初始化
- [ ] 多模型并发对比

## 许可证

[MIT License](./LICENSE)

---

<p align="center">
  由 <a href="https://github.com/guozongzhi">@guozongzhi</a> 构建
</p>
