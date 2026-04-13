/**
 * MessageReducer — 消息列表的不可变更新器
 * 所有消息操作通过此模块进行，保证不可变性和类型安全
 */
import { randomUUID } from 'node:crypto';

// ─── 类型 ──────────────────────────────────────────────

/** UI 层展示的已完成消息 */
export type CompletedMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'thinking';
  content: string;
  /** 消息时间戳 */
  timestamp: number;
};

/** 工具执行状态 */
export type ToolExecution = {
  id: string;
  name: string;
  args: any;
  status: 'queued' | 'running' | 'success' | 'error';
  result?: string;
  /** 开始时间（用于计算耗时） */
  startTime: number;
  /** 完成时间 */
  endTime?: number;
  /** 执行耗时 ms */
  durationMs?: number;
  /** Bash 工具的实时输出（最后几行） */
  liveOutput?: string;
};

/** 权限审批请求 */
export type ApprovalRequest = {
  toolName: string;
  argsSummary: string;
  /** 完整的工具参数（用于 diff 预览） */
  fullArgs?: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  reject: () => void;
};

// ─── 消息 ID 生成 ──────────────────────────────────────

export function nextMsgId(): string {
  return randomUUID();
}

// ─── 不可变操作函数 ──────────────────────────────────────

/**
 * 追加消息（返回新数组）
 */
export function appendMessage(
  messages: CompletedMessage[],
  role: CompletedMessage['role'],
  content: string,
): CompletedMessage[] {
  return [
    ...messages,
    {
      id: nextMsgId(),
      role,
      content,
      timestamp: Date.now(),
    },
  ];
}

/**
 * 追加用户消息
 */
export function appendUserMessage(messages: CompletedMessage[], content: string): CompletedMessage[] {
  return appendMessage(messages, 'user', content);
}

/**
 * 追加助手消息
 */
export function appendAssistantMessage(messages: CompletedMessage[], content: string): CompletedMessage[] {
  return appendMessage(messages, 'assistant', content);
}

/**
 * 追加 thinking 消息（Extended Thinking block）
 */
export function appendThinkingMessage(messages: CompletedMessage[], content: string): CompletedMessage[] {
  return appendMessage(messages, 'thinking', content);
}

/**
 * 追加系统消息
 */
export function appendSystemMessage(messages: CompletedMessage[], content: string): CompletedMessage[] {
  return appendMessage(messages, 'system', content);
}

/**
 * 追加思考过程消息
 */
export function appendThinkingMessage(messages: CompletedMessage[], content: string): CompletedMessage[] {
  return appendMessage(messages, 'thinking', content);
}

// ─── 工具执行操作 ──────────────────────────────────────

/**
 * 添加新的工具执行记录
 */
export function addToolExecution(
  executions: ToolExecution[],
  name: string,
  args: any,
): ToolExecution[] {
  return [
    ...executions,
    {
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      args,
      status: 'running',
      startTime: Date.now(),
    },
  ];
}

/**
 * 更新工具执行状态（完成时）
 */
export function completeToolExecution(
  executions: ToolExecution[],
  name: string,
  result: string,
  isError: boolean,
): ToolExecution[] {
  return executions.map(t => {
    if (t.name === name && t.status === 'running') {
      const endTime = Date.now();
      return {
        ...t,
        status: isError ? ('error' as const) : ('success' as const),
        result,
        endTime,
        durationMs: endTime - t.startTime,
      };
    }
    return t;
  });
}

/**
 * 更新工具的实时输出（Bash 工具用）
 */
export function updateToolLiveOutput(
  executions: ToolExecution[],
  name: string,
  output: string,
): ToolExecution[] {
  return executions.map(t => {
    if (t.name === name && t.status === 'running') {
      return { ...t, liveOutput: output };
    }
    return t;
  });
}
