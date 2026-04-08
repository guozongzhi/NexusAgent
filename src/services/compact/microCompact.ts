/**
 * MicroCompact — 本地工具结果清理（零 API 成本）
 *
 * 参考 Claude Code 的 microCompact.ts：
 * 在每次 LLM 请求前，将旧的 tool_result 内容替换为占位符，
 * 保留最近 N 个工具结果完整内容。
 *
 * 这是最轻量级的上下文压缩策略，不消耗任何 API 调用。
 */
import type { Message, ContentBlock, ToolResultContentBlock } from '../../types/index.ts';
import { estimateTokens } from '../history/tokenWindow.ts';

/** 工具结果被清理后的占位符 */
export const TOOL_RESULT_CLEARED = '[工具结果已清理]';

/** 保留最近 N 个工具调用的完整结果 */
const DEFAULT_KEEP_RECENT = 6;

/** 可以被清理的工具名称集合 */
const COMPACTABLE_TOOLS = new Set([
  'bash', 'file_read', 'file_write', 'file_edit',
  'glob', 'grep', 'list_dir',
]);

/**
 * 收集消息历史中所有可压缩的 tool_use ID（按出现顺序）
 */
function collectCompactableToolIds(messages: Message[]): string[] {
  const ids: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || typeof msg.content === 'string') continue;
    const blocks = msg.content as ContentBlock[];
    for (const block of blocks) {
      if (block.type === 'tool_use' && COMPACTABLE_TOOLS.has(block.name)) {
        ids.push(block.id);
      }
    }
  }
  return ids;
}

/**
 * 估算单个 tool_result 的 token 数
 */
function estimateToolResultTokens(block: ToolResultContentBlock): number {
  return estimateTokens(block.content);
}

export interface MicroCompactResult {
  /** 处理后的消息列表 */
  messages: Message[];
  /** 本次清理节省的估算 token 数 */
  tokensSaved: number;
  /** 清理的工具结果数量 */
  toolsCleared: number;
}

/**
 * 执行 MicroCompact：清理旧的工具结果内容
 *
 * @param messages 完整消息历史
 * @param keepRecent 保留最近 N 个工具结果（默认 6）
 * @returns 处理后的消息 + 统计信息
 */
export function microCompactMessages(
  messages: Message[],
  keepRecent: number = DEFAULT_KEEP_RECENT,
): MicroCompactResult {
  // 收集所有可压缩的工具 ID
  const allToolIds = collectCompactableToolIds(messages);
  if (allToolIds.length <= keepRecent) {
    return { messages, tokensSaved: 0, toolsCleared: 0 };
  }

  // 保留最近 N 个，清理其余的
  const keepSet = new Set(allToolIds.slice(-keepRecent));
  const clearSet = new Set(allToolIds.filter(id => !keepSet.has(id)));

  let tokensSaved = 0;
  let toolsCleared = 0;

  const result: Message[] = messages.map(msg => {
    // 只处理包含 tool_result 的 user 消息
    if (msg.role !== 'user' || typeof msg.content === 'string') return msg;

    const blocks = msg.content as ContentBlock[];
    let touched = false;

    const newBlocks = blocks.map(block => {
      if (
        block.type === 'tool_result' &&
        clearSet.has(block.tool_use_id) &&
        block.content !== TOOL_RESULT_CLEARED
      ) {
        tokensSaved += estimateToolResultTokens(block);
        toolsCleared++;
        touched = true;
        return { ...block, content: TOOL_RESULT_CLEARED } as ToolResultContentBlock;
      }
      return block;
    });

    if (!touched) return msg;
    return { ...msg, content: newBlocks };
  });

  return { messages: result, tokensSaved, toolsCleared };
}
