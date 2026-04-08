/**
 * Compact Service — LLM 摘要压缩核心
 *
 * 参考 Claude Code 的 compact.ts：
 * 将完整对话历史发送给 LLM 生成结构化摘要，
 * 然后用摘要 + 最近消息替换全部历史。
 */
import type { LLMAdapter, Message } from '../../types/index.ts';
import { getCompactPrompt, formatCompactSummary, getCompactUserSummaryMessage } from './prompt.ts';
import { estimateTokens } from '../history/tokenWindow.ts';

/** 压缩结果 */
export interface CompactionResult {
  /** 压缩后的消息列表（摘要 + 保留的最近消息） */
  messages: Message[];
  /** 压缩前 token 估算 */
  preCompactTokens: number;
  /** 压缩后 token 估算 */
  postCompactTokens: number;
  /** 用户可见的状态消息 */
  displayMessage: string;
}

/**
 * 估算消息列表的总 token 数
 */
export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content) + 4;
    } else {
      total += estimateTokens(JSON.stringify(msg.content)) + 4;
    }
  }
  return total;
}

/**
 * 执行 LLM 摘要压缩
 *
 * @param messages 完整消息历史
 * @param adapter LLM 适配器
 * @param model 模型名称
 * @param systemPrompt 系统提示词
 * @param options 压缩选项
 */
export async function compactConversation(
  messages: Message[],
  adapter: LLMAdapter,
  model: string,
  systemPrompt: string,
  options: {
    customInstructions?: string;
    keepRecentMessages?: number;
    onProgress?: (status: string) => void;
  } = {},
): Promise<CompactionResult> {
  const { customInstructions, keepRecentMessages = 4, onProgress } = options;

  if (messages.length < 3) {
    throw new Error('消息数量不足，无法压缩。');
  }

  const preCompactTokens = estimateMessagesTokens(messages);
  onProgress?.('正在生成对话摘要...');

  // 构建压缩请求：将全部历史作为上下文 + compact prompt 作为最后一条 user 消息
  const compactPrompt = getCompactPrompt(customInstructions);
  const compactMessages: Message[] = [
    ...messages,
    { role: 'user', content: compactPrompt },
  ];

  // 调用 LLM 生成摘要（非流式，直接收集全部文本）
  let summaryText = '';
  for await (const event of adapter.stream({
    model,
    systemPrompt,
    messages: compactMessages,
    tools: [], // 压缩请求不传工具
    temperature: 0.3, // 低温以确保忠实摘要
    maxTokens: 8192,
  })) {
    if (event.type === 'text_delta') {
      summaryText += event.text;
    } else if (event.type === 'error') {
      throw new Error(`压缩失败: ${event.error}`);
    }
  }

  if (!summaryText.trim()) {
    throw new Error('LLM 未返回有效的摘要内容。');
  }

  onProgress?.('正在重建上下文...');

  // 格式化摘要（剥离 analysis 标签）
  const formattedSummary = formatCompactSummary(summaryText);

  // 构建压缩后的消息列表
  const summaryMessage = getCompactUserSummaryMessage(formattedSummary, true);

  // 保留最近 N 条消息原文
  const recentMessages = messages.slice(-keepRecentMessages);

  const compactedMessages: Message[] = [
    // 系统边界标记
    { role: 'system', content: `[上下文已压缩] 之前的 ${messages.length} 条消息已被摘要替代。` },
    // 摘要注入
    { role: 'user', content: summaryMessage },
    { role: 'assistant', content: '我已了解之前的对话上下文，现在继续工作。' },
    // 保留的最近消息
    ...recentMessages,
  ];

  const postCompactTokens = estimateMessagesTokens(compactedMessages);

  return {
    messages: compactedMessages,
    preCompactTokens,
    postCompactTokens,
    displayMessage: `上下文已压缩: ${preCompactTokens} → ${postCompactTokens} tokens（${messages.length} → ${compactedMessages.length} 条消息）`,
  };
}
