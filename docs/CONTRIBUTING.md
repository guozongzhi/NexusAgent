# 贡献指南

感谢你对 Nexus Agent 的关注！本文档将帮助你了解如何参与贡献。

## 开发环境

### 前置要求

- [Bun](https://bun.sh) 1.0+
- [Git](https://git-scm.com/)
- 一个支持 TypeScript 的编辑器 (推荐 VS Code)

### 克隆与安装

```bash
git clone https://github.com/guozongzhi/NexusAgent.git
cd NexusAgent
bun install
```

### 开发命令

```bash
bun run dev          # 启动开发模式
bun test             # 运行全部测试
bun test --watch     # 监听模式测试
bun run typecheck    # TypeScript 类型检查
```

## 代码规范

### TypeScript

- 使用 TypeScript **严格模式** (`strict: true`)
- 所有导出函数必须有 JSDoc 注释
- 禁止使用 `any`，使用 `unknown` + 类型守卫
- 文件级注释说明模块职责

### 文件命名

```
src/tools/FileReadTool.ts    # PascalCase 工具文件名
src/services/compact/        # camelCase 服务目录
src/utils/path.ts            # camelCase 工具函数
tests/compact.test.ts        # 对应模块名 + .test.ts
```

### 注释语言

所有代码注释和文档使用**简体中文**。

## 项目结构

```
src/
├── main.tsx              # 入口：Ink App + 查询循环
├── QueryEngine.ts        # ReAct 引擎 + 断路器
├── Tool.ts               # 工具注册表
├── context.ts            # System Prompt + Planner 注入
├── config.ts             # 配置管理 (含 MCP Servers)
├── commands/             # 斜杠命令 (/mcp, /config...)
├── components/           # Ink UI 组件
├── tools/                # 工具实现 (含 TaskManageTool)
├── services/             # 业务服务
│   ├── api/              # LLM 适配器
│   ├── compact/          # 上下文压缩
│   ├── history/          # 会话管理
│   ├── mcp/              # MCP 客户端管理器
│   └── agent/            # Agent 状态机与规划
├── security/             # 安全防护 + 持久化权限
├── types/                # 类型定义
└── utils/                # 工具函数
```

## 贡献流程

### 1. 开始之前

- 查看 [Issues](https://github.com/guozongzhi/NexusAgent/issues) 是否有相同的问题
- 对于大的改动，请先开 Issue 讨论方案

### 2. 创建分支

```bash
git checkout -b feature/your-feature
# 或
git checkout -b fix/bug-description
```

### 3. 开发

- 编写代码和测试
- 确保 `bun test` 全部通过
- 确保 `bun run typecheck` 无错误

### 4. 提交

使用 [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git commit -m "feat: 添加新的搜索工具"
git commit -m "fix: 修复路径遍历检查边界条件"
git commit -m "docs: 更新安装文档"
git commit -m "test: 补充 compact 模块测试"
git commit -m "refactor: 重构 QueryEngine 流式处理"
```

### 5. Pull Request

- 描述清楚改动内容和动机
- 关联相关 Issue
- 确保 CI 通过

## 添加新功能

### 添加工具

1. 创建 `src/tools/YourTool.ts`:

```typescript
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

const inputSchema = z.object({
  // 定义输入参数
});

export const YourTool = registerTool({
  name: 'your_tool',
  description: '工具描述',
  inputSchema,
  isReadOnly: true, // 或 false
  async call(input, context): Promise<ToolResult> {
    // 实现逻辑
    return { output: '结果' };
  },
});
```

2. 在 `src/tools/index.ts` 中 import:

```typescript
import './YourTool.ts';
```

3. 更新 `tests/core.test.ts` 中的工具数量断言

### 添加命令

在 `src/commands/router.ts` 的 `switch` 语句中添加:

```typescript
case '/yourcommand': {
  // 实现逻辑
  return { handled: true, output: '输出结果' };
}
```

## 测试

### 测试文件

| 文件 | 覆盖模块 |
|------|---------|
| `tests/core.test.ts` | 工具注册表、路径工具、System Prompt |
| `tests/security.test.ts` | 路径防护、命令黑名单、敏感文件 |
| `tests/compact.test.ts` | MicroCompact、Prompt 模板、Token 估算 |
| `tests/tokenWindow.test.ts` | Token 估算、消息截断 |

### 编写测试

```typescript
import { describe, test, expect } from 'bun:test';

describe('模块名', () => {
  test('行为描述', () => {
    // Arrange
    // Act
    // Assert
    expect(result).toBe(expected);
  });
});
```

### 运行测试

```bash
bun test                         # 全部
bun test tests/compact.test.ts   # 单个文件
bun test --watch                 # 监听模式
```

## 报告 Bug

请在 [GitHub Issues](https://github.com/guozongzhi/NexusAgent/issues) 中创建 Issue，包含：

1. **环境信息**: `nexus doctor` 输出
2. **复现步骤**: 最小化的步骤列表
3. **预期行为 vs 实际行为**
4. **截图/日志** (如有)

## 许可证

本项目采用 [MIT License](./LICENSE)。提交贡献即表示你同意以此许可证发布你的代码。
