/**
 * QueryEngine — ReAct 循环核心引擎
 *
 * 重构版：工具调度逻辑移至 ToolRouter，QueryEngine 仅负责：
 * 1. 接收用户查询，构建 System Prompt + 历史消息
 * 2. 调用 LLM 获取流式响应
 * 3. 如果 LLM 返回 tool_use → 委托 ToolRouter 执行 → 将结果注入消息 → 继续循环
 * 4. 如果 LLM 返回 end_turn → 提取最终文本并返回
 */
import type {
  LLMAdapter,
  Message,
  ContentBlock,
  ToolUseContentBlock,
  TextContentBlock,
  ToolResultContentBlock,
  QueryResult,
  OpenAIFunctionDef,
  ToolUseContext,
} from './types/index.ts';
import { ToolRouter, type ToolRouterCallbacks } from './core/ToolRouter.ts';

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
  /** 工具路由器 */
  toolRouter?: ToolRouter;
  /** 流式文本回调 */
  onTextDelta?: (text: string) => void;
  /** 思考过程回调 */
  onThinking?: (text: string) => void;
  /** 工具调用开始回调 */
  onToolStart?: (name: string, input: Record<string, unknown>) => void;
  /** 工具权限请求，返回 true 则允许执行 */
  onToolApprovalRequest?: (name: string, input: Record<string, unknown>) => Promise<boolean>;
  /** 工具调用结束回调 */
  onToolEnd?: (name: string, result: string, isError: boolean, durationMs: number) => void;
  /** 中断信令 */
  abortSignal?: AbortSignal;
  /** 重试回调 */
  onRetry?: (attempt: number, maxRetries: number, delayMs: number, error: string) => void;
}

/** 单次循环最大迭代次数 */
const MAX_ITERATIONS = 100;
/** 连续工具调用失败的断路器 */
const MAX_CONSECUTIVE_ERRORS = 3;

export class QueryEngine {
  private adapter: LLMAdapter;

  constructor(adapter: LLMAdapter) {
    this.adapter = adapter;
  }

  /**
   * 运行 ReAct 循环
   */
  async run(params: QueryEngineParams): Promise<QueryResult> {
    const {
      systemPrompt, model, messages, toolDefs, toolContext,
      toolRouter, onTextDelta, onThinking, onToolStart, onToolApprovalRequest, onToolEnd,
      onRetry,
    } = params;

    let iterations = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let consecutiveErrors = 0;

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
        abortSignal: params.abortSignal,
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

          case 'usage':
            totalPromptTokens += event.promptTokens;
            totalCompletionTokens += event.completionTokens;
            break;

          case 'error':
            return {
              text: event.error,
              usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
            };

          case 'thinking_delta':
            onThinking?.(event.text);
            break;

          case 'retry':
            onRetry?.(event.attempt, event.maxRetries, event.delayMs, event.error);
            break;
        }
      }

      // 断路器检查
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return {
          text: `[Warning] 连续发生 ${consecutiveErrors} 次工具执行错误，已触发断路器挂起并等待用户介入。`,
          usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
        };
      }

      // 如果 LLM 未返回用量（部分本地模型/Ollama），进行字符级估算
      if (totalPromptTokens === 0 && totalCompletionTokens === 0) {
        totalPromptTokens = Math.ceil(JSON.stringify(messages).length / 4);
        totalCompletionTokens = Math.ceil(textAccum.length / 4) + toolCalls.length * 20;
      }

      // 无工具调用 → 终止循环
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

      // ═══ 工具执行：委托给 ToolRouter ═══
      let toolResults: ToolResultContentBlock[];
      let currentTurnHasError: boolean;

      if (toolRouter) {
        // 新架构：使用 ToolRouter
        const routingResult = await toolRouter.executeToolCalls(
          toolCalls,
          toolContext,
          {
            onToolStart,
            onToolEnd,
            onToolApprovalRequest,
          },
        );
        toolResults = routingResult.results;
        currentTurnHasError = routingResult.hasError;
      } else {
        // 兼容旧架构：内联执行（后续会移除）
        toolResults = [];
        currentTurnHasError = false;
        const { getTool } = await import('./Tool.ts');
        const { mcpManager } = await import('./services/mcp/McpClientManager.ts');

        for (const tc of toolCalls) {
          onToolStart?.(tc.name, tc.input);

          if (tc.name.startsWith('mcp__')) {
            const [_, serverName, ...toolParts] = tc.name.split('__');
            const originalToolName = toolParts.join('__');
            try {
              const res = await mcpManager.callTool(serverName!, originalToolName, tc.input);
              onToolEnd?.(tc.name, res.output, res.isError ?? false, 0);
              if (res.isError) currentTurnHasError = true;
              toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: res.output, is_error: res.isError });
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              onToolEnd?.(tc.name, msg, true, 0);
              currentTurnHasError = true;
              toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] ${msg}`, is_error: true });
            }
            continue;
          }

          const tool = getTool(tc.name);
          if (!tool) {
            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] 未知工具: ${tc.name}`, is_error: true });
            onToolEnd?.(tc.name, `未知工具`, true, 0);
            currentTurnHasError = true;
            continue;
          }

          if (onToolApprovalRequest) {
            const approved = await onToolApprovalRequest(tc.name, tc.input);
            if (!approved) {
              toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: '[ERROR] 用户拒绝', is_error: true });
              onToolEnd?.(tc.name, '用户拒绝', true, 0);
              continue;
            }
          }

          const parsed = tool.inputSchema.safeParse(tc.input);
          if (!parsed.success) {
            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] 参数校验失败: ${parsed.error.message}`, is_error: true });
            onToolEnd?.(tc.name, '参数校验失败', true, 0);
            currentTurnHasError = true;
            continue;
          }

          try {
            const result = await tool.call(parsed.data, toolContext);
            onToolEnd?.(tc.name, result.output, result.isError ?? false, 0);
            if (result.isError) currentTurnHasError = true;
            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result.output, is_error: result.isError });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            onToolEnd?.(tc.name, msg, true, 0);
            currentTurnHasError = true;
            toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] ${msg}`, is_error: true });
          }
        }
      }

      // 更新断路器
      if (currentTurnHasError) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 0;
      }

      // 将工具结果追加为 user 消息
      for (const tr of toolResults) {
        messages.push({ role: 'user', content: [tr] });
      }
    }

    return {
      text: '[Warning] 达到最大迭代次数限制，已终止执行循环。',
      usage: { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens },
    };
  }
}
