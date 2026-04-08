# Nexus Agent 架构设计

本文档描述 Nexus Agent 的系统架构和核心设计决策。

## 设计哲学

1. **Agent 而非 Copilot** — 直接执行操作，而不是仅仅给出建议
2. **安全优先** — 所有写入操作需要人类确认
3. **流式优先** — 所有 LLM 交互使用 SSE 流式输出
4. **可扩展** — 工具/命令/LLM 适配器均为插件化注册

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
│       │                                                       │
│       ▼                                                       │
│  buildSystemPromptAsync() ──► context.ts + NEXUS.md           │
│       │                                                       │
│       ▼                                                       │
│  autoCompactIfNeeded() ──► compact/ (MicroCompact + Full)     │
│       │                                                       │
│       ▼                                                       │
│  QueryEngine.run() ──► ReAct 循环                             │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                    QueryEngine                                │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │               ReAct Loop (stream)                        │ │
│  │                                                          │ │
│  │  1. 发送 messages + tools → LLM                         │ │
│  │  2. 流式接收 response                                    │ │
│  │  3. 如果有 tool_call:                                    │ │
│  │     a. 权限检查 (isReadOnly? → auto, else → confirm)     │ │
│  │     b. 执行 tool.call()                                  │ │
│  │     c. 将 tool_result 追加到 messages                    │ │
│  │     d. 回到步骤 1                                        │ │
│  │  4. 如果是纯文本 → 返回最终响应                           │ │
│  └─────────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
┌────────────────┐ ┌────────────────┐ ┌────────────────────┐
│   LLM Adapter  │ │  Tool Registry │ │  Security Layer    │
│                │ │                │ │                    │
│  OpenAIAdapter │ │  bash          │ │  validatePath()    │
│  (OpenAI SDK)  │ │  file_read     │ │  validateCommand() │
│                │ │  file_write    │ │  validateWriteSize │
│  stream()      │ │  file_edit     │ │  validateSensitive │
│                │ │  list_dir      │ │                    │
│  支持:         │ │  glob          │ │  Unicode NFC       │
│  · OpenAI      │ │  grep          │ │  路径遍历防护       │
│  · Ollama      │ │  note          │ │  敏感文件拦截       │
│  · vLLM        │ │                │ │  命令黑名单         │
│  · LiteLLM     │ │  registerTool()│ │                    │
└────────────────┘ └────────────────┘ └────────────────────┘
```

## 核心模块

### 1. QueryEngine (`src/QueryEngine.ts`)

ReAct 查询引擎，负责 LLM 交互循环：

- **输入**: System Prompt + Messages + Tool Definitions
- **处理**: 流式解析 SSE → 提取 tool_call → 执行 → 追加结果 → 循环
- **输出**: AsyncGenerator<StreamEvent>

关键设计：
- 单次 `run()` 调用可能触发多轮 tool_call 循环
- 每轮 tool_call 的结果通过 `tool_result` message 追加到上下文
- 流式事件通过 AsyncGenerator yield 给 UI 层

### 2. Tool 系统 (`src/Tool.ts` + `src/tools/`)

插件化工具注册机制：

```typescript
// 注册一个工具
registerTool({
  name: 'my_tool',
  description: '工具描述',
  inputSchema: z.object({ ... }),
  isReadOnly: true,
  async call(input, context) { ... }
});
```

设计要点：
- Zod schema 自动转换为 OpenAI function parameters
- `isReadOnly` 决定是否需要用户确认
- 所有工具通过 `import` 副作用自动注册

### 3. 上下文压缩 (`src/services/compact/`)

三层压缩策略：

| 层级 | 触发条件 | 成本 | 策略 |
|------|---------|------|------|
| MicroCompact | token > 50% 窗口 | 零 | 清理旧 tool_result 内容 |
| Full Compact | token > 80% 窗口 | 1 次 LLM 调用 | 9 段式结构化摘要 |
| Truncate | Fallback | 零 | 丢弃最旧消息 |

Full Compact 的 9 段摘要格式：
1. 主要请求与意图
2. 关键技术概念
3. 文件与代码变更
4. 待办任务
5. 当前工作
6. 重要上下文
7. 用户偏好
8. 错误与经验
9. 下一步计划

### 4. 安全层 (`src/security/pathGuard.ts`)

防御纵深设计：

```
用户输入 → Unicode NFC 规范化 → 路径解析 → 范围检查 → 敏感文件检查 → 执行
                                                          ↓
                                              命令黑名单过滤 (仅 bash)
```

### 5. UI 层 (`src/components/`)

基于 Ink (React for CLI) 的终端 UI：

- **静态区域**: 已完成的消息 (append-only，不重绘)
- **动态区域**: 当前流式输出 + 输入框 + 状态栏

避免闪烁的关键：消息完成后移入 `<Static>` 区域，终端只重绘动态区域。

## 数据流

```
用户输入
  │
  ├─ 以 / 开头? ──► CommandRouter ──► 直接返回结果
  │
  └─► 追加到 historyRef
        │
        ├─► autoCompactIfNeeded()
        │     ├─ MicroCompact (清理旧 tool_result)
        │     └─ Full Compact (LLM 摘要, 含断路器)
        │
        ├─► truncateMessages() (最终安全截断)
        │
        └─► QueryEngine.run()
              │
              ├─ stream: text_delta ──► UI 渲染
              ├─ stream: tool_use ──► ToolPanel + 权限检查
              ├─ stream: tool_result ──► 追加 + 继续循环
              └─ stream: done ──► 完成，移入 Static 区域
```

## 配置系统

```
优先级: 命令行参数 > 环境变量 > ~/.nexus/config.json > 默认值

~/.nexus/
├── config.json          # 用户配置
└── sessions/            # 会话历史
    └── <hash>.json

项目级:
└── NEXUS.md             # 项目 AI 行为规范
```

## 扩展指南

### 添加新工具

1. 在 `src/tools/` 创建 `MyTool.ts`
2. 使用 `registerTool()` 注册
3. 在 `src/tools/index.ts` 中 import
4. 完成——工具会自动出现在 LLM 的可用工具列表中

### 添加新命令

在 `src/commands/router.ts` 的 switch 中添加新 case。

### 支持新的 LLM 提供商

实现 `LLMAdapter` 接口：

```typescript
interface LLMAdapter {
  name: string;
  stream(params: LLMStreamParams): AsyncGenerator<StreamEvent>;
}
```

## 与 Claude Code 的对比

| 系统 | Claude Code | Nexus Agent |
|------|-------------|-------------|
| 分发方式 | 原生二进制 + npm | Bun 源码 + curl 安装 |
| 运行时 | 内嵌 Node.js | Bun |
| LLM | Claude (Anthropic) | 任意 OpenAI 兼容 |
| UI | Ink | Ink |
| 工具系统 | 53 个内置 | 8 个核心 |
| 上下文压缩 | 5 层 15 文件 | 3 层 5 文件 |
| 安全 | 4 级权限 + ML | 2 级 + 黑名单 |
| 开源 | MIT | MIT |
