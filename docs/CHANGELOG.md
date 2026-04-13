# Changelog

所有重要变更记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/)，
版本号遵循 [Semantic Versioning](https://semver.org/)。

## [0.4.0] - 2026-04-14

### 新增 — 架构彻底重构与核心解耦

- **拆分单体模块** — 终结 \`main.tsx\` 及 \`useAgentLoop\` 单体地狱，划分为清晰边界的 \`core/\` 核心驱动层。
- **状态集中管理 (\`AgentState\`)** — 抽出基于发布/订阅模式的状态管理器，脱离 React 生命周期限制，支持无缝重渲染与强交互。
- **纯函数流水线 (\`MessageReducer\`)** — 所有消息体使用不可变追加、更新策略，根除乱序与污染问题。
- **并行工具分配器 (\`ToolRouter\`)** — 掌控权限审查与统一超时阻断机制（最高 120s 保护），大幅简化 QueryEngine 的职责。
- **独立流适配器 (\`StreamProcessor\`)** — 全新设计 150ms 缓冲节流池，彻底解决超大数据量输出时的全屏闪现与算力枯竭问题。
- **中断中枢 (\`InterruptController\`)** — 处理统一的 AbortSignal 生命周期与优雅终止。
- **后台任务集群 (\`JobManager\`)** — 新增进程池订阅，托管支持流控截断的长期常驻任务（Server/Watcher）。

### 新增 — 功能与 UI 革新

- **增强思考呈现 (Extended Thinking)** — 原生支持分析型模型流式思考文本 (`<thinking>`)，置于浅灰色折叠区渲染，不再破坏常规对话框。
- **多行编辑与回溯 (\`MultiLineInput\`)** — 替换原有单行 \`TextInput\` 组件，增加由 \`InputHistory\` 驱动的 \`↑\` \`↓\` 指令级记录巡回导航。
- **启发式输入智能提示 (\`useProactiveTips\`)** — 根据当前输入的命令符或触发词，展示防呆指南与隐藏技巧快捷方式。
- **三态引擎模式 (\`AgentMode\`)** — \`Shift + Tab\` 热键一键轮询 \`act\`（标准）、\`plan\`（严格只读）和 \`auto-approve\`（超级静默自动化）三种执行模式。
- **微观统计分析** — 状态栏加入精确进度计算。结合服务器下行真实 Token 与本地估算，实现 \`CostTracker\` USD 精准级成本统计。

### 新增 — 工具与服务补完

- **工具库扩编 (12 → 16)** — 新增 \`JobManageTool\` (守护进程), \`MultiEditTool\` (多区块替换), \`SymbolSearchTool\` (符号索引查询), \`MemoryTool\` (外部记忆调用)。
- **自动化防御体系扩展: 快照还原 (\`FileVault\`)** — 基于本地文件加密与 MD5，为高危变更动作建立修改前数据快照，提供高强度级容灾及可回溯管理。
- **系统层 L2/L3 自治发现** — 后台触发 \`DiscoveryService\` 探索和推测项目技术栈画像，并通过 \`WorkspaceGraph\` 获取微观指针，利用 \`DistillationService\` 在长时对话中提纯避坑经验注入长期记忆。

### 变更

- 所有内部定时轮询和流解析模块均加入进程优雅退出（SIGINT/SIGTERM）析构响应。
- 移除了对旧版历史架构的全局依赖，改为 \`sessionStore\` 接口对接。

## [0.3.0] - 2026-04-10

### 新增 — 功能扩展

- **网络获取能力** — `WebFetchTool` (HTML/JSON 抓取) + `WebSearchTool` (DuckDuckGo 搜索)
- **Jupyter 编辑** — `NotebookEditTool` 提供按 cell 索引的结构化 `.ipynb` CRUD 操作
- **长效记忆系统** — `memoryStore.ts` 管理 `~/.nexus/memory.json`，自动注入 System Prompt
  - `/memory add|rm|list|clear|global` 命令支持
- **可编程技能** — `skillManager.ts` + `~/.nexus/skills/*.json` 工作流配置
  - `/skills list|add|rm` + `/sk <name>` 快捷执行
  - `rewrittenQuery` 机制将技能 prompt 无缝重定向到 QueryEngine
- **Git 工作流命令** — `/init` (NEXUS.md 初始化) / `/diff` (Git 状态) / `/commit` (提交辅助)
- **成本追踪** — `/cost` 命令基于 Token 用量进行财务估算
- **CI/CD 静默模式** — `--dangerously-skip-permissions` CLI 标志，跳过所有工具权限确认
- **NPM 分发准备** — `package.json` 标准化 (`private: false`)，`scripts/build.ts` Bun compile 二进制构建

### 新增 — 架构加固

- **配置 Schema 验证** — Zod `NexusConfigFileSchema.strict()` + `safeParse()` 运行时校验
  - 校验失败打印逐字段错误信息，降级为默认配置继续运行
- **Session 生命周期** — UUID v4 会话 ID + `index.json` 元数据索引
  - `listSessions()` / `resumeSession()` API（为 `/resume` 命令准备）
  - 向后兼容旧格式（cwd hash 单文件）的自动迁移读取
- **进程退出资源释放** — `process.on(exit/SIGINT/SIGTERM)` → `mcpManager.closeAll()` 优雅关闭
- **LLM 适配器工厂** — `createAdapter(config)` 根据 `provider` 路由，Ollama 自动修正 baseURL
- **统一工具超时** — 全部 12 个工具附带 60s `Promise.race` 超时保护
- **配置热重载** — `/config set` 后自动重连 MCP 服务器
- **ToolUseContext 完整填充** — `sessionId` + `isAuthorized` 字段
- **分层错误边界** — `buildSystemPromptAsync` 降级 + `loadConfig` 独立捕获 + 针对性修复提示
- **并行工具执行** — 同一 turn 多 tool_call 通过 `Promise.allSettled` 并发
- **AbortController** — Ctrl+C 全链路中断支持

### 变更

- 版本号升级至 `0.3.0`
- `package.json` 新增 `author`, `license`, `repository`, `keywords`, `files`, `build`, `prepublishOnly`
- `adapterRef` 类型从 `OpenAIAdapter` 改为抽象 `LLMAdapter` 接口
- 工具总数从 9 → 12（新增 web_fetch, web_search, notebook_edit）
- Session 存储从 `session_<hash>.json` 单文件改为 `<uuid>.json` + 索引

### 测试

- 59 个测试用例 / 162 个断言，全部通过
- `tsc --noEmit` 零错误

## [0.2.0] - 2026-04-09

### 新增

- **MCP 协议支持** — 通过 `@modelcontextprotocol/sdk` 动态加载外部工具
  - `McpClientManager` 管理多个 stdio 子进程服务器
  - `/mcp add|rm|list` 命令行管理
  - 工具以 `mcp__<server>__<tool>` 格式自动合并进 Agent
- **Agent Planner** — 自主规划与任务管理状态机
  - `TaskManageTool` 支持 add/update/complete/clear/list
  - 任务列表动态注入 System Prompt
  - 三种模式: interactive / plan / execute
- **持久化权限** — Always Allow 跨会话记忆
  - `permissionStore.ts` 读写 `~/.nexus/permissions.json`
  - 支持全局级 + 项目级两层粒度
- **三级权限模型** — `authType: 'safe' | 'requires_confirm' | 'dangerous'`
  - `safe`: 自动放行（只读工具）
  - `requires_confirm`: 默认需确认，可 Always Allow
  - `dangerous`: 强制拦截，无视 Always Allow
- **QueryEngine 断路器** — 连续 3 次工具错误自动熔断
  - `MAX_ITERATIONS` 从 20 放大到 100（支持大规模自动任务）
  - `consecutiveErrors` 计数器防止死循环

### 变更

- 安装脚本移入 `scripts/` 目录
- `ToolDefinition.isReadOnly` 标记为可选，推荐使用 `authType`
- `NexusConfig` 新增 `mcpServers` 字段

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
