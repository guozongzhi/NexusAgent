# Nexus Agent 架构设计

本文档描述 Nexus Agent 的系统架构和核心设计决策。

## 设计哲学

1. **Agent 而非 Copilot** — 直接执行操作，而不是仅仅给出建议
2. **安全优先** — 分级权限控制，高危操作强制拦截
3. **流式优先** — 所有 LLM 交互使用 SSE 流式输出
4. **可扩展** — 工具/命令/LLM 适配器均为插件化注册，支持 MCP 外挂

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                     Terminal (stdin/stdout)                    │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                      Ink UI Layer                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ Welcome  │ │ Spinner  │ │ToolPanel │ │PermissionPrompt │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────────┘ │
│  ┌──────────────────────────────────────┐ ┌───────────────┐ │
│  │          StatusBar                    │ │  Onboarding   │ │
│  └──────────────────────────────────────┘ └───────────────┘ │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                      main.tsx (App)                           │
│                                                               │
│  handleSubmit() ──► 命令路由 ──► CommandRouter                │
│       │                    ├─ /mcp (MCP 管理)                │
│       │                    ├─ /memory (长效记忆)              │
│       │                    ├─ /skills, /sk (技能系统)         │
│       │                    ├─ /commit, /diff, /init (Git)    │
│       │                    └─ /config, /compact, /cost...    │
│       ▼                                                       │
│  buildSystemPromptAsync() ──► context.ts + planner + NEXUS.md│
│       │                       + Long-term Memory 注入        │
│       │                                                       │
│  autoCompactIfNeeded() ──► compact/ (MicroCompact + Full)    │
│       │                                                       │
│  MCP Tool Merge ──► local tools + mcpManager.getAllTools()    │
│       │                                                       │
│  QueryEngine.run() ──► ReAct 循环 + 断路器 + 60s 超时保护    │
└────────────────────────────┬─────────────────────────────────┘
                             │
    ┌────────────────────────┼────────────────────────┐
    ▼                        ▼                        ▼
┌──────────────┐  ┌───────────────────┐  ┌────────────────────┐
│ LLM Adapter  │  │  Tool Registry    │  │  Security Layer    │
│              │  │  (12 tools)       │  │                    │
│ adapterFact- │  │                   │  │  validatePath()    │
│ ory.ts 工厂  │  │  bash             │  │  validateCommand() │
│              │  │  file_read/write  │  │  validateWriteSize │
│ createAdapt- │  │  file_edit        │  │  validateSensitive │
│ er(config)   │  │  list_dir/glob    │  │                    │
│              │  │  grep / note      │  │  permissionStore   │
│ 支持:        │  │  task_manage      │  │  (持久化权限)      │
│ · OpenAI     │  │  web_fetch        │  │                    │
│ · Ollama     │  │  web_search       │  │  pathGuard         │
│ · vLLM       │  │  notebook_edit    │  │  (路径+命令校验)   │
│ · LiteLLM    │  │  ─────────────    │  │                    │
│              │  │  mcp__* (动态)    │  │  --dangerously-    │
│              │  │  registerTool()   │  │  skip-permissions  │
└──────────────┘  └───────────────────┘  └────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │     MCP Client Manager      │
              │                             │
              │  connectAll() → 并行启动     │
              │  getAllTools() → 拉取工具列表 │
              │  callTool() → 跨进程 RPC     │
              │  closeAll() → 优雅退出       │
              │                             │
              │  stdio transport ── 子进程   │
              └─────────────────────────────┘
```

## 核心模块

### 1. QueryEngine (`src/QueryEngine.ts`)

ReAct 查询引擎，负责 LLM 交互循环：

- **输入**: System Prompt + Messages + Tool Definitions (本地 + MCP 合并)
- **处理**: 流式解析 SSE → 提取 tool_call → 权限检查 → 执行 → 追加结果 → 循环
- **输出**: QueryResult { text, usage }
- **熔断**: 连续 3 次工具执行错误自动挂起（Circuit Breaker）

关键设计：
- 单次 `run()` 调用最多触发 100 轮 tool_call 循环（支持大规模自动任务）
- 同一 turn 多个 tool_call 并发执行（`Promise.allSettled`），审批串行
- 每个工具调用附带 60 秒统一超时保护（`Promise.race`）
- MCP 工具以 `mcp__<server>__<tool>` 前缀标识，单独路由到外部进程
- `consecutiveErrors` 计数器防止死循环吞噬 token
- `AbortController` 支持用户 Ctrl+C 中断整个 ReAct 链路

### 2. Tool 系统 (`src/Tool.ts` + `src/tools/`)

插件化工具注册机制：

```typescript
registerTool({
  name: 'my_tool',
  description: '工具描述',
  inputSchema: z.object({ ... }),
  authType: 'requires_confirm',  // 'safe' | 'requires_confirm' | 'dangerous'
  async call(input, context) { ... }
});
```

设计要点：
- Zod schema 自动转换为 OpenAI function parameters
- `authType` 三级权限：`safe` 自动放行 / `requires_confirm` 可 Always Allow / `dangerous` 强制拦截
- 兼容旧 `isReadOnly` 字段，自动映射到 `safe` / `requires_confirm`

### 3. 权限系统 (`src/security/`)

```
工具调用请求
    │
    ├─ authType === 'safe' ──► 直接执行
    │
    ├─ authType === 'requires_confirm'
    │     ├─ permissionStore 命中 ──► 自动执行 (跨会话 Always Allow)
    │     └─ 未命中 ──► PermissionPrompt (Y/N/A)
    │                     └─ A ──► 写入 ~/.nexus/permissions.json
    │
    └─ authType === 'dangerous' ──► 强制 PermissionPrompt (无视 Always Allow)
```

持久化存储支持全局级 (`alwaysAllowedGlobal`) 和项目级 (`alwaysAllowedProject`) 两层粒度。

### 4. MCP 客户端 (`src/services/mcp/`)

通过 `@modelcontextprotocol/sdk` 实现标准 MCP 客户端：
- 基于 stdio transport 管理多个外部子进程服务器
- 自动拉取工具列表并以 `mcp__server__tool` 格式合并到 LLM function calling
- 跨进程 RPC 调用与错误隔离

### 5. Agent Planner (`src/services/agent/planner.ts`)

Agent 状态机与任务管理：
- 三种模式: `interactive` | `plan` | `execute`
- 任务清单通过 `getPlannerContext()` 动态注入 System Prompt
- `TaskManageTool` 提供给 LLM 自主建立/更新/完成任务的能力

### 6. 上下文压缩 (`src/services/compact/`)

三层压缩策略：

| 层级 | 触发条件 | 成本 | 策略 |
|------|---------|------|------|
| MicroCompact | token > 50% 窗口 | 零 | 清理旧 tool_result 内容 |
| Full Compact | token > 80% 窗口 | 1 次 LLM 调用 | 9 段式结构化摘要 |
| Truncate | Fallback | 零 | 丢弃最旧消息 |

### 7. UI 层 (`src/components/`)

基于 Ink (React for CLI) 的终端 UI：

- **静态区域**: 已完成的消息 (append-only，不重绘)
- **动态区域**: 当前流式输出 + 输入框 + 状态栏

避免闪烁的关键：消息完成后移入 `<Static>` 区域，终端只重绘动态区域。

## 数据流

```
用户输入
  │
  ├─ 以 / 开头? ──► CommandRouter ──► 直接返回结果
  │                    └─ /mcp add/rm/list → 管理外部工具
  │
  └─► 追加到 historyRef
        │
        ├─► autoCompactIfNeeded()
        │     ├─ MicroCompact (清理旧 tool_result)
        │     └─ Full Compact (LLM 摘要, 含断路器)
        │
        ├─► truncateMessages() (最终安全截断)
        │
        ├─► Merge: getAllFunctionDefs() + mcpManager.getAllTools()
        │
        └─► QueryEngine.run()
              │
              ├─ tool_call(mcp__*)  ──► mcpManager.callTool()
              ├─ tool_call(local)   ──► getTool() → tool.call()
              │    └─ 权限检查: safe → auto / requires_confirm → store/prompt / dangerous → prompt
              └─ text → 完成，移入 Static 区域
```

## 配置系统

```
优先级: 命令行参数 > 环境变量 > ~/.nexus/config.json > 默认值
Schema: Zod 运行时校验（NexusConfigFileSchema.strict()）

~/.nexus/
├── config.json          # 用户配置 (含 mcpServers)，Zod 运行时校验
├── permissions.json     # 持久化权限 (Always Allow)
├── memory.json          # 跨会话长效记忆
├── sessions/            # 会话历史（UUID 索引）
│   ├── index.json       # 会话元数据索引 (cwd, createdAt, lastActive)
│   └── <uuid>.json      # 独立会话文件
└── skills/              # 可编程技能配置
    └── <name>.json      # 技能定义 (name, description, prompt)

项目级:
└── NEXUS.md             # 项目 AI 行为规范
```

### 8. 长效记忆系统 (`src/services/memory/`)

- `memoryStore.ts` 管理 `~/.nexus/memory.json` 持久化存储
- 支持 `global` 和 `project` 两种作用域
- `buildSystemPromptAsync()` 在每次 Query 前自动注入相关记忆到 `<LONG_TERM_MEMORY>` 标签
- `/memory add|rm|list|clear|global` 命令行管理

### 9. 技能系统 (`src/services/skills/`)

- `skillManager.ts` 解析 `~/.nexus/skills/` 目录下的 JSON 技能文件
- `/skills list|add|rm` + `/sk <name>` 快捷执行
- 通过 `rewrittenQuery` 机制将技能 prompt 重定向到 QueryEngine

### 10. LLM 适配器工厂 (`src/services/api/adapterFactory.ts`)

- `createAdapter(config)` 根据 `provider` 字段分派适配器实例
- `ollama` 自动修正 baseURL 为 `localhost:11434/v1`
- 保证多供应商路由真正工作，而不是声明式空挂

## 扩展指南

### 添加新工具

1. 在 `src/tools/` 创建 `MyTool.ts`
2. 使用 `registerTool()` 注册，指定 `authType`
3. 在 `src/tools/index.ts` 中 import
4. 完成——工具会自动出现在 LLM 的可用工具列表中

### 添加新命令

在 `src/commands/router.ts` 的 switch 中添加新 case。

### 添加 MCP 外部工具

```bash
/mcp add <name> <command> [args...]
# 例：/mcp add sqlite npx -y @modelcontextprotocol/server-sqlite --db test.db
```

或直接编辑 `~/.nexus/config.json` 的 `mcpServers` 字段。

### 支持新的 LLM 提供商

实现 `LLMAdapter` 接口，并在 `adapterFactory.ts` 中注册分派逻辑：

```typescript
interface LLMAdapter {
  name: string;
  stream(params: LLMStreamParams): AsyncIterable<StreamEvent>;
}
```

### CLI 参数

```bash
nexus                              # 交互模式
nexus "你的任务描述"                # 一次性非交互模式
nexus --dangerously-skip-permissions  # CI/CD 静默模式（跳过所有权限确认）
```

### 构建与分发

```bash
bun run build         # 使用 Bun compile 打包为独立二进制
bun run typecheck     # TypeScript 严格模式检查
bun test              # 59 个测试用例
npm publish           # 发布到 npm (需先 npm login)
```
