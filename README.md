<p align="center">
  <h1 align="center">Nexus Agent</h1>
  <p align="center">
    <strong>基于 ReAct 范式的自主编程 CLI Agent</strong>
  </p>
  <p align="center">
    <a href="#快速开始">快速开始</a> •
    <a href="#核心能力">核心能力</a> •
    <a href="#工具系统">工具</a> •
    <a href="#命令参考">命令</a> •
    <a href="#架构">架构</a> •
    <a href="docs/CONTRIBUTING.md">贡献</a>
  </p>
</p>

---

Nexus Agent 是一个运行在终端中的**自主编程助手**。它理解你的代码库，通过自然语言指令直接执行文件操作、代码重构、Shell 命令、网络搜索等任务——在你的本地环境中**行动**，而不是仅仅给出建议。

```
$ nexus
┌─────────────────────────────────────────────────────────────┐
│  Nexus Agent v0.3.0                                         │
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
|---------|---------|
| 操作系统 | macOS 12+, Ubuntu 20.04+, Windows 10 1809+ |
| 运行时 | [Bun](https://bun.sh) 1.0+ (安装脚本自动安装) |
| 硬件 | 4 GB+ RAM, x64 或 ARM64 |
| 网络 | 需要互联网连接 (调用 LLM API) |

### 安装

**macOS / Linux (推荐):**

```bash
curl -fsSL https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/guozongzhi/NexusAgent/main/scripts/install.ps1 | iex
```

**从源码安装:**

```bash
git clone https://github.com/guozongzhi/NexusAgent.git
cd NexusAgent
bun install
bun run dev
```

### 配置

启动前设置 LLM API Key：

```bash
export OPENAI_API_KEY="sk-..."
```

或启动后使用内置命令：

```
/config set apiKey sk-...
```

支持任何 OpenAI 兼容 API（Ollama、vLLM、LiteLLM 等）：

```bash
export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"
```

### 启动

```bash
nexus                                    # 交互模式
nexus "重构 src/utils 的所有函数"          # 一次性非交互模式
nexus --dangerously-skip-permissions      # CI/CD 静默模式
```

## 核心能力

### 🧠 ReAct 推理引擎

- **多轮自主推理** — 最多 100 轮 tool_call 循环，支持复杂的大规模任务
- **并行工具执行** — 同一轮次多个 tool_call 通过 `Promise.allSettled` 并发执行
- **断路器保护** — 连续 3 次工具错误自动熔断，防止 Token 无限消耗
- **统一超时控制** — 每个工具调用 60 秒超时保护，防止单工具死锁
- **中断支持** — `Ctrl+C` 通过 AbortController 全链路中断

### 🔍 网络搜索与信息获取

- **WebFetchTool** — 抓取任意 URL 内容（HTML→纯文本 / JSON 解析）
- **WebSearchTool** — 基于 DuckDuckGo 的互联网搜索，自动解码跳转链接

### 🧬 跨会话长效记忆

```
/memory add "本项目使用 pnpm 作为包管理器"
/memory add "代码风格偏好：函数式编程，避免 class"
/memory list
```

记忆持久化存储在 `~/.nexus/memory.json`，每次对话开始前自动注入 System Prompt，让 Agent 真正"记住"你的偏好。

### ⚡ 可编程技能系统

```
/skills add review-pr "审查当前 Git 变更，给出代码质量评估和改进建议"
/sk review-pr                    # 一键执行预设工作流
/skills list                     # 查看所有技能
```

技能存储在 `~/.nexus/skills/*.json`，通过 prompt 重定向机制无缝接管 QueryEngine。

### 🔌 MCP 扩展协议

支持 [Model Context Protocol](https://modelcontextprotocol.io) 动态加载外部工具：

```
/mcp add sqlite npx -y @modelcontextprotocol/server-sqlite --db test.db
/mcp add github npx -y @modelcontextprotocol/server-github
/mcp list
```

### 📦 上下文压缩

三层自动压缩策略，智能管理 Token 窗口：

| 层级 | 触发条件 | 成本 | 策略 |
|------|---------|------|------|
| MicroCompact | token > 50% | 零 | 清理旧 tool_result 内容 |
| Full Compact | token > 80% | 1 次 LLM 调用 | 9 段式结构化摘要 |
| Truncate | Fallback | 零 | 丢弃最旧消息 |

### 🔒 安全机制

- **路径遍历防护** — 所有文件操作限制在工作目录内（Unicode NFC 规范化）
- **敏感文件保护** — 禁止修改 `.zshrc` / `.ssh/` / `.gitconfig` 等 8 类文件
- **危险命令黑名单** — 拦截 `rm -rf /` / fork 炸弹 / `mkfs` 等
- **三级权限控制** — `safe` / `requires_confirm` / `dangerous`
- **持久化权限** — Always Allow 跨会话记忆 (`~/.nexus/permissions.json`)
- **CI/CD 模式** — `--dangerously-skip-permissions` 跳过所有确认

## 工具系统

Nexus Agent 通过 12 个内置工具覆盖开发全链路：

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
| `task_manage` | 自主规划与任务追踪 | 🔒 需确认 |
| `web_fetch` | 抓取 URL 内容 (HTML/JSON) | ✅ 只读 |
| `web_search` | 互联网搜索 (DuckDuckGo) | ✅ 只读 |
| `notebook_edit` | Jupyter .ipynb 结构化编辑 | 🔒 需确认 |

所有工具使用 Zod Schema 进行输入校验，自动转换为 OpenAI function calling 格式。

## 命令参考

### 斜杠命令

| 命令 | 描述 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清除会话历史和屏幕 |
| `/config <key> <value>` | 动态修改配置 |
| `/model <name>` | 切换 LLM 模型 |
| `/status` | 显示连接状态、模型、token 用量 |
| `/history` | 查看会话消息数和 token 估算 |
| `/compact` | 手动触发上下文压缩 |
| `/mcp list\|add\|rm` | 管理 MCP 扩展插件 |
| `/memory add\|rm\|list\|clear` | 管理跨会话长效记忆 |
| `/skills list\|add\|rm` | 管理可编程技能 |
| `/sk <name>` | 执行指定技能 |
| `/init` | 初始化项目 NEXUS.md |
| `/diff` | 查看 Git 未提交更改 |
| `/commit` | 查看 Git 状态并辅助提交 |
| `/cost` | 查看当前会话 Token 成本估算 |
| `/bug` | 生成环境诊断信息 |
| `/version` | 显示版本号 |
| `/exit` | 退出应用 |

### CLI 参数

```bash
nexus                                    # 交互模式
nexus "任务描述"                          # 一次性非交互模式
nexus --version                          # 版本号
nexus --dangerously-skip-permissions     # CI/CD 静默模式
nexus update                             # 更新到最新版本
nexus doctor                             # 运行环境诊断
```

## 配置

配置文件位于 `~/.nexus/config.json`（Zod 运行时校验）：

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--db", "test.db"]
    }
  }
}
```

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `OPENAI_API_KEY` | OpenAI API 密钥 | — |
| `OPENAI_BASE_URL` | API 基础 URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 默认模型 | `gpt-4o` |
| `NEXUS_API_KEY` | 兼容的 API 密钥别名 | — |
| `NEXUS_PROVIDER` | LLM 提供商 (`openai` / `ollama`) | `openai` |

### 数据目录

```
~/.nexus/
├── config.json          # 用户配置
├── permissions.json     # 持久化权限
├── memory.json          # 跨会话长效记忆
├── sessions/            # 会话历史 (UUID 索引)
│   ├── index.json       # 会话元数据索引
│   └── <uuid>.json      # 独立会话文件
└── skills/              # 可编程技能
    └── <name>.json      # 技能定义
```

## 架构

详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

```
nexus-agent/
├── src/
│   ├── main.tsx              # 应用入口 + Ink UI + CLI 参数解析
│   ├── QueryEngine.ts        # ReAct 引擎 (并行执行 + 超时 + 断路器)
│   ├── Tool.ts               # 工具注册表 (Zod → OpenAI Schema)
│   ├── context.ts            # System Prompt (Planner + Memory 注入)
│   ├── config.ts             # 配置加载 (Zod 运行时校验)
│   ├── commands/
│   │   └── router.ts         # 命令路由 (/mcp /memory /skills /git...)
│   ├── components/           # Ink (React) 终端 UI 组件
│   ├── tools/                # 12 个内置工具
│   │   ├── BashTool.ts       # Shell 命令执行
│   │   ├── File*.ts          # 文件读写编辑
│   │   ├── Glob/Grep/ListDir # 搜索与目录
│   │   ├── NoteTool.ts       # 思考笔记
│   │   ├── TaskManageTool.ts # 任务规划
│   │   ├── WebFetchTool.ts   # URL 内容抓取
│   │   ├── WebSearchTool.ts  # 互联网搜索
│   │   └── NotebookEditTool  # Jupyter 编辑
│   ├── services/
│   │   ├── api/              # LLM 适配层 + 工厂模式
│   │   ├── compact/          # 三层上下文压缩
│   │   ├── history/          # Session (UUID) + Token 窗口
│   │   ├── memory/           # 跨会话长效记忆
│   │   ├── skills/           # 可编程技能管理
│   │   ├── mcp/              # MCP 客户端管理器
│   │   └── agent/            # Agent 状态机 (Planner)
│   ├── security/             # 路径防护 + 权限持久化
│   ├── types/                # 核心类型定义
│   └── utils/                # 工具函数
├── scripts/                  # 安装/卸载/构建脚本
├── tests/                    # 59 个测试用例
├── docs/                     # 项目文档
│   ├── ARCHITECTURE.md       # 系统架构设计
│   ├── CHANGELOG.md          # 变更日志
│   └── CONTRIBUTING.md       # 贡献指南
└── README.md
```

## 开发

```bash
git clone https://github.com/guozongzhi/NexusAgent.git
cd NexusAgent
bun install

bun run dev          # 启动开发模式
bun test             # 运行测试 (59 pass / 162 expect)
bun run typecheck    # TypeScript 严格模式检查
bun run build        # 打包为独立二进制
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
| 扩展 | [MCP SDK](https://modelcontextprotocol.io) | 外部工具协议 |

## 路线图

- [x] ReAct 查询引擎 + 流式输出 + 并行执行
- [x] 12 个内置工具 (含 web_fetch / web_search / notebook_edit)
- [x] 三级权限 + Always Allow 持久化 + CI/CD 静默模式
- [x] 上下文压缩 (MicroCompact + Full Compact + Truncate)
- [x] NEXUS.md 项目指令 + 层级化加载
- [x] 跨平台安装 (macOS/Linux/Windows)
- [x] MCP 协议支持 (动态外挂工具)
- [x] Agent Planner (自主任务规划)
- [x] 断路器 + AbortController 中断
- [x] 跨会话长效记忆 (/memory)
- [x] 可编程技能系统 (/skills)
- [x] Git 工作流 (/init /diff /commit)
- [x] 成本追踪 (/cost)
- [x] Zod 配置校验 + Session UUID
- [x] NPM 标准化分发 + Bun compile 二进制
- [ ] 流式 Markdown 实时渲染
- [ ] 多 Agent 协同 (AgentTool + Coordinator)
- [ ] LSP 语言服务集成
- [ ] IDE 集成 (VS Code / JetBrains Bridge)

## 许可证

[MIT License](./LICENSE)

---

<p align="center">
  由 <a href="https://github.com/guozongzhi">@guozongzhi</a> 构建
</p>
