/**
 * Token 窗口管理器
 * P1-4: 防止历史消息超过模型上下文窗口限制
 *
 * 策略：保留 system prompt + 最近 N 轮对话
 * 超出阈值时自动截断旧消息
 */
import type { Message, ContentBlock } from '../../types/index.ts';

/** 默认 Token 窗口大小（保守估计，避免超出模型限制） */
const DEFAULT_MAX_TOKENS = 100_000;

/**
 * 简易 Token 估算器
 * 平均每 4 个字符约等于 1 个 token（英文为主）
 * 中文字符约 1.5-2 token/字，这里取保守值 2 char/token
 */
export function estimateTokens(text: string): number {
  // 混合场景取平均 3 chars/token
  return Math.ceil(text.length / 3);
}

/**
 * 估算单条消息的 token 数
 */
function estimateMessageTokens(msg: Message): number {
  if (typeof msg.content === 'string') {
    return estimateTokens(msg.content) + 4; // 角色标记开销
  }
  // ContentBlock 数组
  const blocks = msg.content as ContentBlock[];
  let total = 4;
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        total += estimateTokens(block.text);
        break;
      case 'tool_use':
        total += estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input));
        break;
      case 'tool_result':
        total += estimateTokens(block.content);
        break;
    }
  }
  return total;
}

/**
 * 截断消息历史以适应 token 窗口
 * 保留最近的消息，从最旧的开始移除
 *
 * @param messages 完整消息历史
 * @param maxTokens 最大 token 数
 * @returns 截断后的消息列表
 */
export function truncateMessages(messages: Message[], maxTokens: number = DEFAULT_MAX_TOKENS): Message[] {
  if (messages.length === 0) return [];

  // 从后往前累加，直到超过预算
  let budget = maxTokens;
  let keepFrom = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateMessageTokens(messages[i]!);
    if (budget - cost < 0 && keepFrom < messages.length) {
      // 预算不够了，停在这里
      break;
    }
    budget -= cost;
    keepFrom = i;
  }

  const truncated = messages.slice(keepFrom);

  // 如果截断了消息，在开头插入一条提示
  if (keepFrom > 0) {
    truncated.unshift({
      role: 'system' as const,
      content: `[系统] 因上下文窗口限制，已截断 ${keepFrom} 条较早的历史消息。`,
    });
  }

  return truncated;
}
