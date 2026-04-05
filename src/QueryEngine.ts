/**
 * QueryEngine — ReAct 循环核心引擎
 *
 * 核心职责：
 * 1. 接收用户查询，构建 System Prompt + 历史消息
 * 2. 调用 LLM 获取流式响应
 * 3. 如果 LLM 返回 tool_use → 执行工具 → 将结果注入消息 → 继续循环
 * 4. 如果 LLM 返回 end_turn → 提取最终文本并返回
 */
import type {
  LLMAdapter,
  Message,
  StreamEvent,
  ContentBlock,
  ToolUseContentBlock,
  TextContentBlock,
  ToolResultContentBlock,
  QueryResult,
  OpenAIFunctionDef,
  ToolUseContext,
} from './types/index.ts';
import { getTool } from './Tool.ts';

/** QueryEngine 运行参数 */
export interface QueryEngineParams {
  /** System Prompt */
  systemPrompt: string;
  /** 模型名称 */
  model: string;
  /** 对话消息历史 */
  messages: Message[];
  /** 所有可用工具的 function definitions */
  toolDefs: OpenAIFunctionDef[];
  /** 工具执行上下文 */
  toolContext: ToolUseContext;
  /** 流式文本回调 */
  onTextDelta?: (text: string) => void;
  /** 工具调用开始回调 */
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  /** 工具权限请求，返回 true 则允许执行 */
  onToolApprovalRequest?: (name: string, input: Record<string, unknown>) => Promise<boolean>;
  /** 工具调用结束回调 */
  onToolEnd?: (name: string, result: string, isError: boolean) => void;
}

/** 单次循环最大迭代次数（防止无限循环） */
const MAX_ITERATIONS = 20;

export class QueryEngine {
  private adapter: LLMAdapter;

  constructor(adapter: LLMAdapter) {
    this.adapter = adapter;
  }

  /**
   * 运行 ReAct 循环
   * 返回最终文本响应
   */
  async run(params: QueryEngineParams): Promise<QueryResult> {
    const { systemPrompt, model, messages, toolDefs, toolContext, onTextDelta, onToolStart, onToolApprovalRequest, onToolEnd } = params;

    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      // 收集本轮流式事件
      let textAccum = '';
      const toolCalls: ToolUseContentBlock[] = [];
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn';

      for await (const event of this.adapter.stream({
        model,
        systemPrompt,
        messages,
        tools: toolDefs,
      })) {
        switch (event.type) {
          case 'text_delta':
            textAccum += event.text;
            onTextDelta?.(event.text);
            break;

          case 'tool_use':
            toolCalls.push({
              type: 'tool_use',
              id: event.id,
              name: event.name,
              input: event.input,
            });
            break;

          case 'done':
            stopReason = event.stopReason;
            break;

          case 'error':
            // 错误直接返回
            return {
              text: `[LLM Error] ${event.error}`,
              usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
            };
        }
      }

      // 无工具调用 → 终止循环，返回文本
      if (toolCalls.length === 0 || stopReason === 'end_turn') {
        return {
          text: textAccum,
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        };
      }

      // 构建 assistant 消息（含 text + tool_use blocks）
      const assistantContent: ContentBlock[] = [];
      if (textAccum) {
        assistantContent.push({ type: 'text', text: textAccum } as TextContentBlock);
      }
      assistantContent.push(...toolCalls);
      messages.push({ role: 'assistant', content: assistantContent });

      // 执行每个工具调用
      const toolResults: ToolResultContentBlock[] = [];
      for (const tc of toolCalls) {
        onToolStart?.(tc.name, tc.input);

        const tool = getTool(tc.name);
        if (!tool) {
          const errResult: ToolResultContentBlock = {
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `[ERROR] 未知工具: ${tc.name}`,
            is_error: true,
          };
          toolResults.push(errResult);
          onToolEnd?.(tc.name, errResult.content, true);
          continue;
        }

        if (onToolApprovalRequest) {
          const approved = await onToolApprovalRequest(tc.name, tc.input);
          if (!approved) {
            const errResult: ToolResultContentBlock = {
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `[ERROR] 用户拒绝了执行此工具`,
              is_error: true,
            };
            toolResults.push(errResult);
            onToolEnd?.(tc.name, errResult.content, true);
            continue;
          }
        }

        try {
          // 校验输入
          const parsed = tool.inputSchema.safeParse(tc.input);
          if (!parsed.success) {
            const errResult: ToolResultContentBlock = {
              type: 'tool_result',
              tool_use_id: tc.id,
              content: `[ERROR] 参数校验失败: ${parsed.error.message}`,
              is_error: true,
            };
            toolResults.push(errResult);
            onToolEnd?.(tc.name, errResult.content, true);
            continue;
          }

          const result = await tool.call(parsed.data, toolContext);
          const toolResult: ToolResultContentBlock = {
            type: 'tool_result',
            tool_use_id: tc.id,
            content: result.output,
            is_error: result.isError,
          };
          toolResults.push(toolResult);
          onToolEnd?.(tc.name, result.output, result.isError ?? false);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const errResult: ToolResultContentBlock = {
            type: 'tool_result',
            tool_use_id: tc.id,
            content: `[ERROR] 工具执行异常: ${msg}`,
            is_error: true,
          };
          toolResults.push(errResult);
          onToolEnd?.(tc.name, errResult.content, true);
        }
      }

      // 将工具结果作为 user 消息追加（OpenAI 需要 role=tool，内部消息格式统一用 user）
      for (const tr of toolResults) {
        messages.push({ role: 'user', content: [tr] });
      }
    }

    // 超过最大迭代次数
    return {
      text: '[Warning] 达到最大迭代次数限制，已终止执行循环。',
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
    };
  }
}
