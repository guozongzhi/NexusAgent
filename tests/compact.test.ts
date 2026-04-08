/**
 * Compact 系统测试
 */
import { describe, test, expect } from 'bun:test';
import { microCompactMessages, TOOL_RESULT_CLEARED } from '../src/services/compact/microCompact.ts';
import { formatCompactSummary, getCompactPrompt, getCompactUserSummaryMessage } from '../src/services/compact/prompt.ts';
import { estimateMessagesTokens } from '../src/services/compact/compact.ts';
import { createAutoCompactState } from '../src/services/compact/autoCompact.ts';
import type { Message, ContentBlock } from '../src/types/index.ts';

// ─── MicroCompact 测试 ─────────────────────────────────

describe('MicroCompact', () => {
  function makeToolHistory(toolCount: number): Message[] {
    const messages: Message[] = [];
    for (let i = 0; i < toolCount; i++) {
      // assistant: tool_use
      messages.push({
        role: 'assistant',
        content: [
          { type: 'tool_use', id: `tool_${i}`, name: 'file_read', input: { filePath: `file_${i}.ts` } },
        ] as ContentBlock[],
      });
      // user: tool_result
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: `tool_${i}`, content: `文件内容 ${i}: ${'x'.repeat(100)}` },
        ] as ContentBlock[],
      });
    }
    return messages;
  }

  test('工具数量少于阈值时不清理', () => {
    const messages = makeToolHistory(3);
    const result = microCompactMessages(messages, 6);
    expect(result.toolsCleared).toBe(0);
    expect(result.tokensSaved).toBe(0);
  });

  test('工具数量超过阈值时清理旧结果', () => {
    const messages = makeToolHistory(10);
    const result = microCompactMessages(messages, 4);
    expect(result.toolsCleared).toBe(6); // 10 - 4 = 6 个被清理
    expect(result.tokensSaved).toBeGreaterThan(0);
  });

  test('清理后的 tool_result 内容被替换为占位符', () => {
    const messages = makeToolHistory(8);
    const result = microCompactMessages(messages, 2);

    // 检查被清理的旧结果
    const userMessages = result.messages.filter(m => m.role === 'user');
    for (let i = 0; i < 6; i++) {
      const blocks = userMessages[i]!.content as ContentBlock[];
      const toolResult = blocks.find(b => b.type === 'tool_result');
      expect(toolResult).toBeDefined();
      if (toolResult && toolResult.type === 'tool_result') {
        expect(toolResult.content).toBe(TOOL_RESULT_CLEARED);
      }
    }

    // 检查保留的最近结果
    for (let i = 6; i < 8; i++) {
      const blocks = userMessages[i]!.content as ContentBlock[];
      const toolResult = blocks.find(b => b.type === 'tool_result');
      expect(toolResult).toBeDefined();
      if (toolResult && toolResult.type === 'tool_result') {
        expect(toolResult.content).not.toBe(TOOL_RESULT_CLEARED);
      }
    }
  });

  test('纯文本消息不受影响', () => {
    const messages: Message[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！' },
    ];
    const result = microCompactMessages(messages, 2);
    expect(result.toolsCleared).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  test('不可压缩的工具不被清理', () => {
    const messages: Message[] = [
      // 只有 'bash', 'file_read' 等被列为可压缩
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'custom_1', name: 'unknown_tool', input: {} }] as ContentBlock[],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'custom_1', content: '自定义结果' }] as ContentBlock[],
      },
    ];
    const result = microCompactMessages(messages, 0);
    expect(result.toolsCleared).toBe(0);
  });
});

// ─── Compact Prompt 测试 ────────────────────────────────

describe('Compact Prompt', () => {
  test('getCompactPrompt 包含核心指令', () => {
    const prompt = getCompactPrompt();
    expect(prompt).toContain('主要请求与意图');
    expect(prompt).toContain('文件与代码');
    expect(prompt).toContain('待办任务');
    expect(prompt).toContain('当前工作');
    expect(prompt).toContain('下一步计划');
  });

  test('getCompactPrompt 附加自定义指令', () => {
    const prompt = getCompactPrompt('重点关注 TypeScript 代码变更');
    expect(prompt).toContain('重点关注 TypeScript 代码变更');
    expect(prompt).toContain('额外压缩指令');
  });

  test('formatCompactSummary 剥离 analysis 标签', () => {
    const raw = `<analysis>
一些内部推理过程...
</analysis>

<summary>
1. 主要请求: 用户要求重构代码
2. 技术概念: TypeScript, React
</summary>`;

    const result = formatCompactSummary(raw);
    expect(result).not.toContain('<analysis>');
    expect(result).not.toContain('</analysis>');
    expect(result).toContain('主要请求: 用户要求重构代码');
    expect(result).toContain('技术概念: TypeScript, React');
  });

  test('formatCompactSummary 处理无标签的原始文本', () => {
    const raw = '这是一段没有标签的纯文本摘要';
    const result = formatCompactSummary(raw);
    expect(result).toBe(raw);
  });

  test('getCompactUserSummaryMessage 包含摘要并抑制追问', () => {
    const msg = getCompactUserSummaryMessage('测试摘要内容', true);
    expect(msg).toContain('测试摘要内容');
    expect(msg).toContain('直接从上次中断的地方继续');
  });

  test('getCompactUserSummaryMessage 不抑制追问时无额外指令', () => {
    const msg = getCompactUserSummaryMessage('测试摘要', false);
    expect(msg).toContain('测试摘要');
    expect(msg).not.toContain('直接从上次中断');
  });
});

// ─── 消息 Token 估算测试 ────────────────────────────────

describe('estimateMessagesTokens', () => {
  test('字符串消息估算', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: '你好世界' },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  test('ContentBlock 消息估算', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '正在读取文件...' },
          { type: 'tool_use', id: 'tid', name: 'file_read', input: { filePath: 'test.ts' } },
        ] as ContentBlock[],
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  test('空消息列表返回 0', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

// ─── AutoCompact State 测试 ─────────────────────────────

describe('AutoCompactState', () => {
  test('初始状态', () => {
    const state = createAutoCompactState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastCompactTurnId).toBeUndefined();
  });
});
