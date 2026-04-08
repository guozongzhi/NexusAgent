/**
 * AutoCompact — 自动上下文压缩触发器
 *
 * 参考 Claude Code 的 autoCompact.ts：
 * 每次 LLM 请求前检测 token 使用量，
 * 超过阈值时自动触发压缩。
 *
 * 压缩层级（由轻到重）：
 * 1. MicroCompact — 清理旧工具结果（零 API 成本）
 * 2. Full Compact — LLM 摘要（消耗一次 API 调用）
 */
import type { LLMAdapter, Message } from '../../types/index.ts';
import { microCompactMessages } from './microCompact.ts';
import { compactConversation, estimateMessagesTokens, type CompactionResult } from './compact.ts';

// ─── 配置 ────────────────────────────────────────────────

/** 默认上下文窗口大小 */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** MicroCompact 触发阈值（占窗口比例） */
const MICRO_COMPACT_THRESHOLD = 0.50; // 50%

/** Full Compact 触发阈值（占窗口比例） */
const FULL_COMPACT_THRESHOLD = 0.80; // 80%

/** Full Compact 连续失败最大次数（断路器） */
const MAX_CONSECUTIVE_FAILURES = 3;

// ─── 状态 ────────────────────────────────────────────────

export interface AutoCompactState {
  /** 连续 compact 失败次数 */
  consecutiveFailures: number;
  /** 上次 compact 的 turn ID */
  lastCompactTurnId?: string;
}

export function createAutoCompactState(): AutoCompactState {
  return { consecutiveFailures: 0 };
}

// ─── 核心 ────────────────────────────────────────────────

export interface AutoCompactOptions {
  adapter: LLMAdapter;
  model: string;
  systemPrompt: string;
  contextWindow?: number;
  onProgress?: (status: string) => void;
}

export interface AutoCompactResult {
  /** 处理后的消息 */
  messages: Message[];
  /** 是否发生了压缩 */
  wasCompacted: boolean;
  /** micro compact 清理的 token 数 */
  microTokensSaved: number;
  /** full compact 结果 */
  compactionResult?: CompactionResult;
  /** 用户可见消息 */
  displayMessage?: string;
}

/**
 * 自动压缩检查 — 在每次 LLM 请求前调用
 *
 * 流程：
 * 1. 始终运行 MicroCompact（轻量级）
 * 2. 若 token 仍超过 FULL_COMPACT_THRESHOLD → 运行 Full Compact
 */
export async function autoCompactIfNeeded(
  messages: Message[],
  state: AutoCompactState,
  options: AutoCompactOptions,
): Promise<AutoCompactResult> {
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const microThreshold = Math.floor(contextWindow * MICRO_COMPACT_THRESHOLD);
  const fullThreshold = Math.floor(contextWindow * FULL_COMPACT_THRESHOLD);

  let currentMessages = messages;
  let microTokensSaved = 0;

  // ── Step 1: MicroCompact（始终检查） ──
  const currentTokens = estimateMessagesTokens(currentMessages);
  if (currentTokens > microThreshold) {
    const mcResult = microCompactMessages(currentMessages);
    currentMessages = mcResult.messages;
    microTokensSaved = mcResult.tokensSaved;

    if (mcResult.toolsCleared > 0) {
      options.onProgress?.(
        `MicroCompact: 清理了 ${mcResult.toolsCleared} 个旧工具结果，节省 ~${mcResult.tokensSaved} tokens`,
      );
    }
  }

  // ── Step 2: Full Compact（仅在 MicroCompact 后仍超阈值时触发） ──
  const postMicroTokens = estimateMessagesTokens(currentMessages);
  if (postMicroTokens > fullThreshold) {
    // 断路器检查
    if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      options.onProgress?.(
        `Auto compact 已触发断路器（连续失败 ${state.consecutiveFailures} 次），跳过`,
      );
      return {
        messages: currentMessages,
        wasCompacted: false,
        microTokensSaved,
        displayMessage: microTokensSaved > 0
          ? `MicroCompact 节省了 ~${microTokensSaved} tokens`
          : undefined,
      };
    }

    try {
      options.onProgress?.('Token 使用量较高，正在执行 Full Compact...');

      const compactionResult = await compactConversation(
        currentMessages,
        options.adapter,
        options.model,
        options.systemPrompt,
        {
          onProgress: options.onProgress,
          keepRecentMessages: 4,
        },
      );

      // 成功 → 重置断路器
      state.consecutiveFailures = 0;

      return {
        messages: compactionResult.messages,
        wasCompacted: true,
        microTokensSaved,
        compactionResult,
        displayMessage: compactionResult.displayMessage,
      };
    } catch (err) {
      state.consecutiveFailures++;
      options.onProgress?.(
        `Full Compact 失败 (${state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${(err as Error).message}`,
      );
    }
  }

  return {
    messages: currentMessages,
    wasCompacted: microTokensSaved > 0,
    microTokensSaved,
    displayMessage: microTokensSaved > 0
      ? `MicroCompact 节省 ~${microTokensSaved} tokens`
      : undefined,
  };
}
