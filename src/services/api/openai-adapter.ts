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
    return messages.map((msg) => {
      // 纯文本消息
      if (typeof msg.content === 'string') {
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      }

      // 含 tool_result 的消息（来自上一次工具调用结果）
      const blocks = msg.content as ContentBlock[];
      const toolResults = blocks.filter((b) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        // OpenAI 格式：每个 tool_result 是独立的 tool message
        return toolResults.map((tr) => ({
          role: 'tool' as const,
          tool_call_id: (tr as { tool_use_id: string }).tool_use_id,
          content: (tr as { content: string }).content,
        }))[0]!; // 简化处理：单 tool_result
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

  /**
   * 流式生成
   */
  async *stream(params: LLMStreamParams): AsyncIterable<StreamEvent> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...this.convertMessages(params.messages),
    ];

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
    });

    // 累计 tool_call 碎片
    const toolCallAccum = new Map<
      number,
      { id: string; name: string; arguments: string }
    >();

    let finishReason: string | null = null;

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
    }

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

    yield { type: 'done', stopReason };
  }
}
