/**
 * Nexus Agent — 核心类型定义
 * 所有模块共享的基础类型集中声明
 */
import type { z } from 'zod';

// ============================================================
// LLM 消息协议
// ============================================================

/** 角色枚举 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** 文本内容块 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** 工具调用请求块 */
export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 工具执行结果块 */
export interface ToolResultContentBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/** 内容块联合类型 */
export type ContentBlock = TextContentBlock | ToolUseContentBlock | ToolResultContentBlock;

/** 标准消息 */
export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

// ============================================================
// 流式事件
// ============================================================

export interface StreamEventTextDelta {
  type: 'text_delta';
  text: string;
}

export interface StreamEventToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamEventDone {
  type: 'done';
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

export interface StreamEventError {
  type: 'error';
  error: string;
}

export type StreamEvent =
  | StreamEventTextDelta
  | StreamEventToolUse
  | StreamEventDone
  | StreamEventError;

// ============================================================
// Tool 系统
// ============================================================

/** 工具执行上下文 */
export interface ToolUseContext {
  /** 会话 ID */
  sessionId: string;
  /** 当前工作目录 */
  cwd: string;
  /** 是否已授权（简易模式下总是需要确认） */
  isAuthorized: boolean;
}

/** 工具执行结果 */
export interface ToolResult<T = unknown> {
  /** 返回给 LLM 的文本摘要 */
  output: string;
  /** 结构化数据（可选） */
  data?: T;
  /** 是否执行出错 */
  isError?: boolean;
}

/** 工具定义（buildTool 的输入） */
export interface ToolDefinition<TInput extends z.ZodType = z.ZodType> {
  /** 工具唯一标识 */
  name: string;
  /** 工具描述，发送给 LLM */
  description: string;
  /** Zod schema 定义输入参数 */
  inputSchema: TInput;
  /** 是否为只读工具（只读工具跳过确认） */
  isReadOnly: boolean;
  /** 工具执行逻辑 */
  call(input: z.infer<TInput>, context: ToolUseContext): Promise<ToolResult>;
}

/** 注册后的工具实例 */
export interface Tool<TInput extends z.ZodType = z.ZodType> extends ToolDefinition<TInput> {
  /** 转换为 OpenAI function calling 格式 */
  toFunctionDef(): OpenAIFunctionDef;
}

/** OpenAI Function Calling 格式 */
export interface OpenAIFunctionDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================
// LLM 适配器
// ============================================================

export interface LLMStreamParams {
  model: string;
  systemPrompt: string;
  messages: Message[];
  tools: OpenAIFunctionDef[];
  temperature?: number;
  maxTokens?: number;
}

export interface LLMAdapter {
  name: string;
  stream(params: LLMStreamParams): AsyncIterable<StreamEvent>;
}

// ============================================================
// QueryEngine
// ============================================================

export interface QueryResult {
  /** 最终文本响应 */
  text: string;
  /** 本次消耗的 token 数 */
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ============================================================
// 配置
// ============================================================

export interface NexusConfig {
  /** LLM 提供商: openai, ollama */
  provider: 'openai' | 'ollama';
  /** API Base URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** 系统提示词 */
  systemPrompt: string;
}
