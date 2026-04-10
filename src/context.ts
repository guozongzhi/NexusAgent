/**
 * System Prompt 构建
 * 定义 Agent 的身份、能力和行为规范
 * 支持 NEXUS.md 项目级指令注入
 */
import { getProjectInstructions } from './services/projectConfig.ts';
import { plannerState } from './services/agent/planner.ts';
import { getRelevantMemories } from './services/memory/memoryStore.ts';
import os from 'node:os';

// ─── 模型能力矩阵 ──────────────────────────────────────
export interface ModelCapabilities {
  contextWindow: number;
  supportsVision: boolean;
  supportsThinking: boolean;
  maxOutputTokens: number;
}

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-4o':           { contextWindow: 128_000, supportsVision: true,  supportsThinking: false, maxOutputTokens: 16_384 },
  'gpt-4o-mini':      { contextWindow: 128_000, supportsVision: true,  supportsThinking: false, maxOutputTokens: 16_384 },
  'gpt-4-turbo':      { contextWindow: 128_000, supportsVision: true,  supportsThinking: false, maxOutputTokens: 4_096 },
  'gpt-3.5-turbo':    { contextWindow: 16_385,  supportsVision: false, supportsThinking: false, maxOutputTokens: 4_096 },
  'claude-3-5-sonnet': { contextWindow: 200_000, supportsVision: true, supportsThinking: true,  maxOutputTokens: 8_192 },
  'claude-3-5-haiku':  { contextWindow: 200_000, supportsVision: true, supportsThinking: false, maxOutputTokens: 8_192 },
  'deepseek-chat':    { contextWindow: 128_000, supportsVision: false, supportsThinking: true,  maxOutputTokens: 8_192 },
  'deepseek-coder':   { contextWindow: 128_000, supportsVision: false, supportsThinking: false, maxOutputTokens: 8_192 },
};

/** 获取模型能力（模糊匹配） */
export function getModelCapabilities(modelName: string): ModelCapabilities {
  // 精确匹配
  if (MODEL_CAPABILITIES[modelName]) return MODEL_CAPABILITIES[modelName];
  // 前缀匹配
  for (const [key, caps] of Object.entries(MODEL_CAPABILITIES)) {
    if (modelName.startsWith(key)) return caps;
  }
  // 默认值
  return { contextWindow: 128_000, supportsVision: false, supportsThinking: false, maxOutputTokens: 4_096 };
}

/** 运行时检测操作系统 */
function detectOS(): string {
  const platform = os.platform();
  switch (platform) {
    case 'darwin': return 'macOS';
    case 'linux': return 'Linux';
    case 'win32': return 'Windows';
    default: return platform;
  }
}

/** 运行时检测 Shell */
function detectShell(): string {
  if (os.platform() === 'win32') return 'PowerShell';
  const shell = process.env['SHELL'] ?? '';
  const base = shell.split('/').pop() ?? 'unknown';
  return base || 'unknown';
}

/**
 * 构建完整 System Prompt（含项目指令）
 * 异步版本，自动加载 NEXUS.md
 */
export async function buildSystemPromptAsync(cwd: string): Promise<string> {
  const base = buildSystemPrompt(cwd);
  const projectInstructions = await getProjectInstructions(cwd);

  let finalPrompt = base;

  // 注入项目指令
  if (projectInstructions) {
    finalPrompt += `

## 项目指令

以下是项目级别的自定义指令（来自 NEXUS.md 文件），你必须严格遵循：

${projectInstructions}`;
  }

  // 注入跨会话长效记忆
  const memories = await getRelevantMemories(cwd);
  if (memories.length > 0) {
    const memoryBlocks = memories.map(m => `- [${new Date(m.createdAt).toLocaleString()}] ${m.snippet}`).join('\n');
    finalPrompt += `

## <LONG_TERM_MEMORY> 长效记忆
以下是属于该会话/目录相关的跨会话持久化记忆，请在解决问题时优先参考并应用这些知识：
${memoryBlocks}
</LONG_TERM_MEMORY>`;
  }

  return finalPrompt;
}

/**
 * 构建基础 System Prompt（同步，不含项目指令）
 */
export function buildSystemPrompt(cwd: string): string {
  return `你是 Nexus Agent，一个强大的命令行 AI 编程助手。

## 核心能力
- 你可以使用工具来读取、编辑、写入文件，列出目录，搜索代码，以及执行 Shell 命令
- 你在用户的本地机器上运行，拥有对文件系统和终端的完整访问能力
- 你应该直接使用工具解决问题，而不是仅仅给出建议

## 当前环境
- 操作系统: ${detectOS()}
- 工作目录: ${cwd}
- Shell: ${detectShell()}

## 可用工具
- **bash**: 执行 Shell 命令（安装依赖、运行脚本、查看进程等）
- **file_read**: 读取文件内容（支持行范围截取）
- **file_write**: 创建新文件或覆盖写入
- **file_edit**: 精确编辑现有文件（提供 old_string + new_string，支持模糊匹配）
- **multi_edit**: 批量编辑多个文件的多个位置（事务语义）
- **list_dir**: 列出目录内容（支持递归模式）
- **glob**: 按 glob 模式搜索文件路径
- **grep**: 按正则表达式全局搜索文件内容
- **note**: 记录思考笔记（不执行任何操作，用于规划和推理）
- **web_fetch**: 获取指定 URL 的内容（网页、API 响应等）
- **web_search**: 在互联网上搜索信息（基于 DuckDuckGo）
- **notebook_edit**: 结构化编辑 Jupyter Notebook (.ipynb) 文件（按 cell 索引增删查改）

## 行为准则
1. **直接解决问题**：当用户提出需求时，直接使用工具操作，而不是给出指导让用户自己去做
2. **先理解再行动**：在修改代码之前，先阅读相关文件以理解上下文
3. **安全第一**：
   - 执行破坏性操作前，先确认当前状态
   - 不要删除用户未明确要求删除的文件
   - 写入文件时确保内容完整
4. **简洁输出**：回复保持简洁专业，除非用户要求详细解释
5. **使用中文**：所有回复和代码注释使用简体中文

## 工具使用策略
- 需要了解项目结构时，先用 list_dir 查看目录，再用 glob 搜索特定文件
- 需要查看文件时，使用 file_read
- 需要修改现有文件时，优先使用 file_edit（精确替换），避免 file_write 覆盖整个文件
- 需要创建新文件时，使用 file_write
- 需要搜索代码内容时，使用 grep
- 需要执行命令时，使用 bash
- 需要执行命令时，使用 bash
- 需要规划复杂任务时，使用 task_manage 和 note 记录思路

${plannerState.getPlannerContext()}`;
}
