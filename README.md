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
│  Nexus Agent v0.4.0                                         │
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

### 运行模式

使用 `Shift + Tab` 热键可在应用内实时切换以下运行模式：
- **Act (标准模式)**: 具备完整代理权限，遇到高危操作进行拦截告警。
- **Plan (安全模式)**: 读操作放行，一切写操作强制拦截。仅限于研究、答疑和分析。
- **Auto-Approve (无人值守)**: 所有工具一律静默通过，适合极限自动化操作。

## 核心能力

### 🧠 ReAct 推理引擎

- **多轮自主推理** — 最多 100 轮 tool_call 循环，支持复杂的大规模任务。
- **并行工具执行** — 同一轮次多个 tool_call 通过 `Promise.allSettled` 并发执行。
- **断路器保护** — 连续 3 次工具错误自动熔断，防止 Token 无限消耗。
- **统一超时控制** — 分级超时器（Bash: 120s / Write: 60s / Read: 30s），防止单工具死锁。
- **Extended Thinking** — 深度整合了类似 Claude Opus / DeepSeek-R1 的思考过程渲染，使用沉寂浅灰色折叠排版 `<thinking>`，杜绝刷屏。

### 📊 L2/L3 自我学习与记忆推延中枢

- **项目基建透写 (L2 Discovery)** — 后台自动化嗅探前端栈/后端库/配置，无声注入全局图谱。
- **复盘沉淀 (L3 Distillation)** — 长对话触发后台大模型二次萃取，将“曾经踩坑的环境错误”固化成了下一轮的预知知识。
- 长期记忆支持 `/memory add|rm|list` 跨会话直接操控。

### ⚡ 进程守护与流媒体处理

- **后台任务集群 (JobManageTool)** — 可随时抛出指令让某条 `npm run dev` 执行到沙箱进程，无需阻塞命令行交互即可抓取 logs！
- **平滑 SSE 处理流 (StreamProcessor)** — 使用最新的 150ms 节流环缓冲，即便数千字的终端高频字符瀑布输出也绝不频闪与卡顿。

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
| Full Compact | token > 80% | 1 次调用 | 9 段式结构化摘要 |
| Truncate | Fallback | 零 | 丢弃最旧消息 |

### 🔒 安全机制

- **FileVault 快照防线** — 写盘替换前默认静默创建原文件快照映射于 `~/.nexus/backups`，极易回滚。
- **基于 AuthType 分发** — 安全（Safe）与预设隔离。
- **持久化权限** — Always Allow 跨会话记忆 (`~/.nexus/permissions.json`)。

## 工具系统

Nexus Agent 目前共搭载 **16 大工具**：

| 工具 | 描述 | 权限 |
|------|------|------|
| `bash` | 执行前台 Shell 命令并监听回显 | 🔒 需确认 |
| `job_manage`| 执行后台守护命令并调度 | 🔒 需确认 |
| `file_read` | 读取文件内容 (支持行范围) | ✅ 只读 |
| `file_write` | 创建或覆盖文件 | 🔒 需确认 |
| `file_edit` | 精确覆盖更新文件内容片段 | 🔒 需确认 |
| `multi_edit` | 允许并行批量替换同一文件的多个锚点 | 🔒 需确认 |
| `notebook_edit`| 高效直击 Jupyter .ipynb 细胞 CRUD | 🔒 需确认 |
| `list_dir` | 探测级目录层级读取 | ✅ 只读 |
| `glob` | 路径统配查找引擎 | ✅ 只读 |
| `grep` | 基于正则的超规模文字遍历搜索 | ✅ 只读 |
| `symbol_search`| 大模块索引层析查阅 | ✅ 只读 |
| `note` | Agent 思维涂鸦 | ✅ 只读 |
| `task_manage` | Planner 架构任务栈管理 | 🔒 需确认 |
| `web_fetch` | JSON/HTML 网页无头静默拉取 | ✅ 只读 |
| `web_search` | DuckDuckGo 深层引擎调度 | ✅ 只读 |
| `memory_tool` | 长效经验及避坑规范提取器 | ✅ 只读 |

## 命令参考

### 斜杠命令

| 命令 | 描述 |
|------|------|
| `/help` | 显示帮助信息 |
| `/clear` | 清除会话历史和屏幕 |
| `/config` | 动态修改配置 (例如: `/config set apiKey xxx`) |
| `/model` | 快速直切 LLM 响应模型 |
| `/status` | 打印全局状态监控及网络测距 |
| `/cost` | 估算当前累计消耗的精确美元记账单 |
| `/compact` | 强制阻断过长的 token 并摘要 |
| `/mcp` | 扩展连接管理 |
| `/memory` | 用户知识增删查 |
| `/skills` | 流水线工作流绑定及指令覆盖 (/sk run) |
| `/init` | 自动配置环境并搭建 `.nexus.md` |
| `/diff` | 提交前审查所有的修改态 |
| `/commit` | 一级工作流确认提交 |

## 架构

核心层重构为高内聚设计（分离式状态机和并行派发池）。
详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 许可证

[MIT License](./LICENSE)

---

<p align="center">
  由 <a href="https://github.com/guozongzhi">@guozongzhi</a> 构建
</p>
