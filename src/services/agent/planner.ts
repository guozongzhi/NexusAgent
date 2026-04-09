export type AgentMode = 'interactive' | 'plan' | 'execute';

export interface TaskChecklist {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done';
}

/** 
 * 单例的 Planner 状态管理。
 * 在实际复杂架构中可考虑将其持久化或挂载到会话上下文中。
 */
class PlannerState {
  public mode: AgentMode = 'interactive';
  public tasks: TaskChecklist[] = [];
  
  public autoExecuteEnabled: boolean = false;

  public setMode(mode: AgentMode) {
    this.mode = mode;
  }

  public enableAutoExecute(enabled: boolean) {
    this.autoExecuteEnabled = enabled;
  }

  public getPlannerContext(): string {
    if (this.mode === 'interactive' && this.tasks.length === 0) {
      return '';
    }
    
    let context = `\n## 任务管理与进度 (全自动模式: ${this.autoExecuteEnabled ? '开启' : '关闭'})\n`;
    if (this.tasks.length === 0) {
      context += `当前无任务。如面临复杂需求，你可以使用 \`task_manage\` 工具制定任务清单。\n`;
    } else {
      context += `任务列表:\n`;
      this.tasks.forEach(t => {
        const check = t.status === 'done' ? 'x' : (t.status === 'in_progress' ? '/' : ' ');
        context += `- [${check}] [${t.id}] ${t.description}\n`;
      });
      context += `\n请优先完成待办任务。`;
    }
    return context;
  }
}

export const plannerState = new PlannerState();
