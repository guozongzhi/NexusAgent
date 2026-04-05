/**
 * Tool 系统 — buildTool 工厂函数 + 工具注册表
 * 借鉴 Claude Code 的 buildTool 模式：Zod Schema 驱动 + 安全默认值
 */
import { z } from 'zod';
import { zodToJsonSchema } from './utils/zod-to-json-schema.ts';
import type { Tool, ToolDefinition, OpenAIFunctionDef, ToolResult, ToolUseContext } from './types/index.ts';

/**
 * 工厂函数：将 ToolDefinition 转换为完整的 Tool 实例
 * 自动生成 OpenAI function calling 的 JSON Schema
 */
export function buildTool<TInput extends z.ZodType>(def: ToolDefinition<TInput>): Tool<TInput> {
  return {
    ...def,
    toFunctionDef(): OpenAIFunctionDef {
      return {
        type: 'function',
        function: {
          name: def.name,
          description: def.description,
          parameters: zodToJsonSchema(def.inputSchema),
        },
      };
    },
  };
}

// ============================================================
// 全局工具注册表
// ============================================================

const _registry = new Map<string, Tool>();

/**
 * 注册工具到全局注册表
 */
export function registerTool<TInput extends z.ZodType>(def: ToolDefinition<TInput>): Tool<TInput> {
  const tool = buildTool(def);
  _registry.set(tool.name, tool as Tool);
  return tool;
}

/**
 * 获取所有已注册工具
 */
export function getAllTools(): Tool[] {
  return Array.from(_registry.values());
}

/**
 * 按名称查找工具
 */
export function getTool(name: string): Tool | undefined {
  return _registry.get(name);
}

/**
 * 获取所有工具的 OpenAI function definitions
 */
export function getAllFunctionDefs(): OpenAIFunctionDef[] {
  return getAllTools().map((t) => t.toFunctionDef());
}

export type { Tool, ToolDefinition, ToolResult, ToolUseContext };
