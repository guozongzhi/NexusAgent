/**
 * AgentState — 集中状态容器
 * 管理所有 Agent 运行时状态，不依赖 React
 * 提供 subscribe 机制供 React Hook 桥接
 */
import type { CompletedMessage, ToolExecution, ApprovalRequest } from './MessageReducer.ts';
import type { SpinnerMode } from '../components/Spinner.tsx';
import type { AgentMode } from '../types/index.ts';
import type { ProjectProfile } from '../services/memory/DiscoveryService.ts';

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
  /** Agent 运行模式 */
  agentMode: AgentMode;
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
  /** 累计上传 (Prompt) token 数 */
  promptTokens: number;
  /** 累计下传 (Completion) token 数 */
  completionTokens: number;
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 已使用的上下文 token 估算 */
  contextUsedTokens: number;
  /** 本次会话成本 (USD) */
  sessionCostUsd: number;
  /** 后台挂起任务数量 */
  activeBackgroundJobs: number;
  /** 项目画像 */
  projectProfile?: ProjectProfile;
  /** 是否正在进行经验沉淀 */
  isLearning: boolean;
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
      agentMode: 'act',
      completedMessages: [],
      inputValue: '',
      isProcessing: false,
      streamingText: '',
      spinnerMode: 'idle',
      toolExecutions: [],
      pendingApproval: null,
      tokenCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      contextWindow: 128_000,
      contextUsedTokens: 0,
      sessionCostUsd: 0,
      activeBackgroundJobs: 0,
      isLearning: false,
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
