/**
 * NoteTool — 思考笔记工具
 *
 * 参考 Claude Code 的 NoteTool：
 * 让 Agent 在复杂任务中记录思考过程，不执行任何实际操作。
 * 有助于 Agent 在上下文压缩后恢复推理链路。
 */
import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import type { ToolResult } from '../types/index.ts';

const inputSchema = z.object({
  note: z.string().describe('要记录的思考笔记、计划或推理过程'),
  category: z.enum(['plan', 'observation', 'decision', 'question'])
    .optional()
    .describe('笔记类别：plan=计划, observation=观察, decision=决策, question=待确认'),
});

export const NoteTool = registerTool({
  name: 'note',
  description: '记录思考笔记，用于规划任务、记录观察和决策过程。不执行任何操作，仅作为思维记录。在处理复杂任务时使用此工具来组织思路。',
  inputSchema,
  isReadOnly: true,

  async call(input): Promise<ToolResult> {
    const category = input.category || 'observation';
    const prefix = {
      plan: '📋 计划',
      observation: '👁 观察',
      decision: '✅ 决策',
      question: '❓ 待确认',
    }[category];

    return {
      output: `[${prefix}] ${input.note}`,
    };
  },
});
