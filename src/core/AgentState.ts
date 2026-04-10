/**
 * AgentState — 集中状态容器
 * 管理所有 Agent 运行时状态，不依赖 React
 * 提供 subscribe 机制供 React Hook 桥接
 */
import type { CompletedMessage, ToolExecution, ApprovalRequest } from './MessageReducer.ts';
import type { SpinnerMode } from '../components/Spinner.tsx';

// ─── 状态结构 ────────────────────────────────────────

export interface AgentStateSnapshot {
  /** 初始化完成标志 */
  ready: boolean;
  /** API 连通性 */
  apiReady: boolean;
  apiError?: string;
  /** 引导流程 */
  showOnboarding: boolean;
  /** 模型名称 */
  modelName: string;
  /** 已完成的消息列表（沉淀到 Static） */
  completedMessages: CompletedMessage[];
  /** 输入框内容 */
  inputValue: string;
  /** 是否正在处理 */
  isProcessing: boolean;
  /** 流式文本 */
  streamingText: string;
  /** Spinner 模式 */
  spinnerMode: SpinnerMode | 'idle';
  /** 工具执行状态列表 */
  toolExecutions: ToolExecution[];
  /** 待审批的权限请求 */
  pendingApproval: ApprovalRequest | null;
  /** 累计 token 数 */
  tokenCount: number;
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 已使用的上下文 token 估算 */
  contextUsedTokens: number;
  /** 本次会话成本 (USD) */
  sessionCostUsd: number;
}

type Listener = () => void;

/**
 * 集中状态管理器（Zustand 风格，不依赖 React）
 */
export class AgentState {
  private state: AgentStateSnapshot;
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.state = {
      ready: false,
      apiReady: false,
      apiError: undefined,
      showOnboarding: false,
      modelName: 'active',
      completedMessages: [],
      inputValue: '',
      isProcessing: false,
      streamingText: '',
      spinnerMode: 'idle',
      toolExecutions: [],
      pendingApproval: null,
      tokenCount: 0,
      contextWindow: 128_000,
      contextUsedTokens: 0,
      sessionCostUsd: 0,
    };
  }

  /**
   * 获取当前状态快照
   */
  public getState(): AgentStateSnapshot {
    return this.state;
  }

  /**
   * 更新状态（浅合并）
   */
  public setState(partial: Partial<AgentStateSnapshot>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  /**
   * 订阅状态变化
   */
  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 通知所有监听器
   */
  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
