/**
 * Token 窗口管理测试
 * 覆盖：token 估算、消息截断
 */
import { describe, test, expect } from 'bun:test';
import { estimateTokens, truncateMessages } from '../src/services/history/tokenWindow.ts';
import type { Message } from '../src/types/index.ts';

describe('estimateTokens — Token 估算', () => {
  test('短文本估算', () => {
    const tokens = estimateTokens('hello');
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  test('长文本估算（约 3 chars/token）', () => {
    const text = 'a'.repeat(300);
    const tokens = estimateTokens(text);
    expect(tokens).toBe(100);
  });

  test('空文本', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('truncateMessages — 消息截断', () => {
  function makeMsg(role: 'user' | 'assistant', content: string): Message {
    return { role, content };
  }

  test('消息量少时不截断', () => {
    const msgs = [
      makeMsg('user', 'hello'),
      makeMsg('assistant', 'hi there'),
    ];
    const result = truncateMessages(msgs, 10000);
    expect(result.length).toBe(2);
  });

  test('空消息列表', () => {
    expect(truncateMessages([], 1000)).toEqual([]);
  });

  test('超出窗口时截断旧消息', () => {
    // 每条消息约 ~170 tokens (500 chars / 3)
    const msgs: Message[] = [];
    for (let i = 0; i < 20; i++) {
      msgs.push(makeMsg('user', 'x'.repeat(500)));
      msgs.push(makeMsg('assistant', 'y'.repeat(500)));
    }

    // 设置小窗口
    const result = truncateMessages(msgs, 500);

    // 应该被截断
    expect(result.length).toBeLessThan(msgs.length);
    // 应该包含截断提示
    const hasSystemMsg = result.some(m => 
      typeof m.content === 'string' && m.content.includes('已截断')
    );
    expect(hasSystemMsg).toBe(true);
  });

  test('保留最新的消息', () => {
    const msgs = [
      makeMsg('user', 'x'.repeat(500)),
      makeMsg('assistant', 'y'.repeat(500)),
      makeMsg('user', 'LATEST_USER'),
      makeMsg('assistant', 'LATEST_ASSISTANT'),
    ];

    const result = truncateMessages(msgs, 200);

    // 最新的消息应该保留
    const lastMsg = result[result.length - 1];
    expect(typeof lastMsg?.content === 'string' && lastMsg.content).toBe('LATEST_ASSISTANT');
  });
});
