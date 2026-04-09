import { z } from 'zod';
import { registerTool } from '../Tool.ts';
import { plannerState } from '../services/agent/planner.ts';
import type { ToolResult } from '../types/index.ts';

const inputSchema = z.object({
  action: z.enum(['add', 'update', 'complete', 'clear', 'list']).describe('操作类型'),
  taskId: z.string().optional().describe('任务ID，用于 update/complete 操作'),
  description: z.string().optional().describe('任务描述，用于 add/update 操作'),
});

export const TaskManageTool = registerTool({
  name: 'task_manage',
  description: '大中型任务拆解必备：创建、更新、追踪子任务进度。有助于在长上下文中保持思维清晰专注。',
  inputSchema,
  isReadOnly: false,
  async call(input): Promise<ToolResult> {
    const { action, taskId, description } = input;

    switch (action) {
      case 'add':
        if (!description) return { output: '[ERROR] add 必须提供 description', isError: true };
        const id = `t_${Math.floor(Math.random() * 1000)}`;
        plannerState.tasks.push({ id, description, status: 'pending' });
        plannerState.setMode('plan');
        return { output: `[SUCCESS] 任务添加成功，ID: ${id}` };
        
      case 'update':
        if (!taskId || !description) return { output: '[ERROR] update 必须提供 taskId 和 description', isError: true };
        const taskToUpdate = plannerState.tasks.find(t => t.id === taskId);
        if (!taskToUpdate) return { output: `[ERROR] 找不到任务: ${taskId}`, isError: true };
        taskToUpdate.description = description;
        taskToUpdate.status = 'in_progress';
        return { output: `[SUCCESS] 任务 ${taskId} 已更新` };

      case 'complete':
        if (!taskId) return { output: '[ERROR] complete 必须提供 taskId', isError: true };
        const taskToComplete = plannerState.tasks.find(t => t.id === taskId);
        if (!taskToComplete) return { output: `[ERROR] 找不到任务: ${taskId}`, isError: true };
        taskToComplete.status = 'done';
        return { output: `[SUCCESS] 任务 ${taskId} 已标记为完成` };

      case 'clear':
        plannerState.tasks = [];
        plannerState.setMode('interactive');
        return { output: '[SUCCESS] 所有任务均已清除' };

      case 'list':
        if (plannerState.tasks.length === 0) return { output: '目前没有规划中的任务。' };
        const listStr = plannerState.tasks.map(t => `[${t.status === 'done' ? 'x' : ' '}] ${t.id}: ${t.description}`).join('\n');
        return { output: listStr };

      default:
        return { output: '[ERROR] 未知操作', isError: true };
    }
  },
});
