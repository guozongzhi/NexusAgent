/**
 * OpenAI 适配器 — 对接 OpenAI 兼容 API（含 Ollama/vLLM/LiteLLM 等）
 * 核心能力：流式 SSE 响应解析、tool_call 提取
 */
import OpenAI from 'openai';
import type {
  LLMAdapter,
  LLMStreamParams,
  StreamEvent,
  Message,
  ContentBlock,
  OpenAIFunctionDef,
} from '../../types/index.ts';

export class OpenAIAdapter implements LLMAdapter {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(baseUrl: string, apiKey: string) {
    this.client = new OpenAI({
      baseURL: baseUrl,
      apiKey,
    });
  }

  /**
   * 将内部 Message 格式转为 OpenAI SDK 所需格式
   */
  private convertMessages(
    messages: Message[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    // P0-3: 使用 flatMap 将含多个 tool_result 的消息展开为独立 tool message
    type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
    return messages.flatMap((msg): Msg | Msg[] => {
      // 纯文本消息
      if (typeof msg.content === 'string') {
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      }

      // 含 tool_result 的消息（来自上一次工具调用结果）
      const blocks = msg.content as ContentBlock[];
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        // OpenAI 格式：每个 tool_result 是独立的 tool message，全部展开
        return toolResults.map((tr) => ({
          role: 'tool' as const,
          tool_call_id: (tr as { tool_use_id: string }).tool_use_id,
          content: (tr as { content: string }).content,
        }));
      }

      // 含 tool_use 的 assistant 消息
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      if (toolUses.length > 0) {
        const textParts = blocks.filter((b) => b.type === 'text');
        return {
          role: 'assistant' as const,
          content: textParts.map((t) => (t as { text: string }).text).join('') || null,
          tool_calls: toolUses.map((tu) => ({
            id: (tu as { id: string }).id,
            type: 'function' as const,
            function: {
              name: (tu as { name: string }).name,
              arguments: JSON.stringify((tu as { input: Record<string, unknown> }).input),
            },
          })),
        };
      }

      // 纯文本数组
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      return { role: msg.role as 'user' | 'assistant', content: text };
    });
  }

  /** P1-3: 重试配置 */
  private static readonly MAX_RETRIES = 3;
  private static readonly BASE_DELAY_MS = 1000;
  private static readonly STREAM_TIMEOUT_MS = 120_000; // 2分钟超时

  /**
   * 判断错误是否可重试（429/5xx）
   */
  private isRetryable(err: unknown): boolean {
    if (err instanceof OpenAI.APIError) {
      return err.status === 429 || (err.status >= 500 && err.status < 600);
    }
    // 网络错误也可重试
    if (err instanceof Error && (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT') || err.message.includes('fetch failed'))) {
      return true;
    }
    return false;
  }

  /**
   * 流式生成（含指数退避重试 + 超时控制）
   */
  async *stream(params: LLMStreamParams): AsyncIterable<StreamEvent> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...this.convertMessages(params.messages),
    ];

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= OpenAIAdapter.MAX_RETRIES; attempt++) {
      // 非首次尝试时等待指数退避
      if (attempt > 0) {
        const delay = OpenAIAdapter.BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        // P1-3: 超时控制
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OpenAIAdapter.STREAM_TIMEOUT_MS);

        const stream = await this.client.chat.completions.create({
          model: params.model,
          messages,
          tools: params.tools.map((t: OpenAIFunctionDef) => ({
            type: 'function' as const,
            function: t.function,
          })),
          temperature: params.temperature ?? 0.7,
          max_tokens: params.maxTokens ?? 4096,
          stream: true,
          // P2-4: 启用 stream usage 以获取 token 统计
          stream_options: { include_usage: true },
        }, { signal: controller.signal });

        // 累计 tool_call 碎片
        const toolCallAccum = new Map<
          number,
          { id: string; name: string; arguments: string }
        >();

        let finishReason: string | null = null;
        let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // 文本增量
          if (delta.content) {
            yield { type: 'text_delta', text: delta.content };
          }

          // tool_calls 增量（流式拼接）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallAccum.has(idx)) {
                toolCallAccum.set(idx, { id: tc.id ?? '', name: '', arguments: '' });
              }
              const accum = toolCallAccum.get(idx)!;
              if (tc.id) accum.id = tc.id;
              if (tc.function?.name) accum.name += tc.function.name;
              if (tc.function?.arguments) accum.arguments += tc.function.arguments;
            }
          }

          // finish_reason
          if (chunk.choices[0]?.finish_reason) {
            finishReason = chunk.choices[0].finish_reason;
          }

          // P2-4: 捕获 usage（流式模式下在最后一个 chunk 中）
          if ((chunk as any).usage) {
            usage = (chunk as any).usage;
          }
        }

        // 清理超时定时器
        clearTimeout(timeoutId);

        // 发射已完成的 tool_calls
        for (const [, tc] of toolCallAccum) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.arguments) as Record<string, unknown>;
          } catch {
            // JSON 解析失败，保留空对象
          }
          yield { type: 'tool_use', id: tc.id, name: tc.name, input };
        }

        // 完成事件
        const stopReason =
          finishReason === 'tool_calls'
            ? 'tool_use'
            : finishReason === 'length'
              ? 'max_tokens'
              : 'end_turn';

        // P2-4: 发射 usage 事件
        if (usage) {
          yield {
            type: 'usage',
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          };
        }

        yield { type: 'done', stopReason };
        return; // 成功完成，退出重试循环

      } catch (err) {
        lastError = err;
        if (!this.isRetryable(err) || attempt >= OpenAIAdapter.MAX_RETRIES) {
          // 不可重试或已耗尽重试次数
          const msg = err instanceof Error ? err.message : String(err);
          yield { type: 'error', error: `[LLM Error] ${msg} (尝试 ${attempt + 1}/${OpenAIAdapter.MAX_RETRIES + 1} 次)` };
          yield { type: 'done', stopReason: 'end_turn' };
          return;
        }
        // 可重试，继续下一次循环
      }
    }

    // 理论上不应到达这里
    const msg = lastError instanceof Error ? lastError.message : String(lastError);
    yield { type: 'error', error: `[LLM Error] 所有重试均失败: ${msg}` };
    yield { type: 'done', stopReason: 'end_turn' };
  }
}
