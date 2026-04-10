/**
 * ToolRouter — 工具调度层
 * 从 QueryEngine 中提取工具执行逻辑，支持：
 * - Phase 1: 串行权限审批
 * - Phase 2: 并发执行 + 统一超时
 * - 执行计时 + durationMs 回传
 */
import { getTool } from '../Tool.ts';
import { mcpManager } from '../services/mcp/McpClientManager.ts';
import type { ToolUseContentBlock, ToolResultContentBlock, ToolUseContext } from '../types/index.ts';
import { PermissionManager } from './PermissionManager.ts';

// ─── 超时配置（分级）──────────────────────────────────

/** 读操作超时 */
const READ_TIMEOUT_MS = 30_000;
/** 写操作超时 */
const WRITE_TIMEOUT_MS = 60_000;
/** Bash 命令超时 */
const BASH_TIMEOUT_MS = 120_000;

const READ_TOOLS = new Set(['file_read', 'list_dir', 'glob', 'grep', 'note', 'web_search', 'web_fetch']);

function getTimeoutForTool(toolName: string): number {
  if (toolName === 'bash') return BASH_TIMEOUT_MS;
  if (READ_TOOLS.has(toolName)) return READ_TIMEOUT_MS;
  return WRITE_TIMEOUT_MS;
}

// ─── 回调接口 ────────────────────────────────────────

export interface ToolRouterCallbacks {
  /** 工具开始执行 */
  onToolStart?: (name: string, args: Record<string, unknown>) => void;
  /** 工具执行完成 */
  onToolEnd?: (name: string, result: string, isError: boolean, durationMs: number) => void;
  /** 工具权限请求（返回 true 允许执行） */
  onToolApprovalRequest?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
}

// ─── 路由结果 ────────────────────────────────────────

export interface ToolRoutingResult {
  results: ToolResultContentBlock[];
  hasError: boolean;
}

/**
 * 工具调度器
 * 负责权限审批 → 并发执行 → 结果收集
 */
export class ToolRouter {
  private permissionManager: PermissionManager;

  constructor(permissionManager: PermissionManager) {
    this.permissionManager = permissionManager;
  }

  /**
   * 批量执行工具调用（含审批 + 并发执行）
   */
  public async executeToolCalls(
    toolCalls: ToolUseContentBlock[],
    toolContext: ToolUseContext,
    callbacks: ToolRouterCallbacks,
  ): Promise<ToolRoutingResult> {
    const results: ToolResultContentBlock[] = [];
    let hasError = false;

    // ── Phase 1: 串行权限审批 ──
    type ApprovedTask = {
      tc: ToolUseContentBlock;
      kind: 'mcp' | 'local';
      serverName?: string;
      originalToolName?: string;
      tool?: ReturnType<typeof getTool>;
      parsedInput?: unknown;
    };
    const approvedTasks: ApprovedTask[] = [];

    for (const tc of toolCalls) {
      callbacks.onToolStart?.(tc.name, tc.input);

      if (tc.name.startsWith('mcp__')) {
        // MCP 工具
        const [_, serverName, ...toolParts] = tc.name.split('__');
        const originalToolName = toolParts.join('__');

        const permResult = await this.permissionManager.checkPermission(tc.name, 'requires_confirm');
        if (permResult.decision === 'prompt' && callbacks.onToolApprovalRequest) {
          const approved = await callbacks.onToolApprovalRequest(tc.name, tc.input);
          if (!approved) {
            results.push({ type: 'tool_result', tool_use_id: tc.id, content: '[ERROR] 用户拒绝了执行此外部 MCP 工具', is_error: true });
            callbacks.onToolEnd?.(tc.name, '[ERROR] 用户拒绝', true, 0);
            hasError = true;
            continue;
          }
        }
        approvedTasks.push({ tc, kind: 'mcp', serverName, originalToolName });
        continue;
      }

      // 本地工具
      const tool = getTool(tc.name);
      if (!tool) {
        results.push({ type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] 未知工具: ${tc.name}`, is_error: true });
        callbacks.onToolEnd?.(tc.name, `[ERROR] 未知工具: ${tc.name}`, true, 0);
        hasError = true;
        continue;
      }

      const permResult = await this.permissionManager.checkPermission(tc.name, tool.authType, tool.isReadOnly);
      if (permResult.decision === 'prompt' && callbacks.onToolApprovalRequest) {
        const approved = await callbacks.onToolApprovalRequest(tc.name, tc.input);
        if (!approved) {
          results.push({ type: 'tool_result', tool_use_id: tc.id, content: '[ERROR] 用户拒绝了执行此工具', is_error: true });
          callbacks.onToolEnd?.(tc.name, '[ERROR] 用户拒绝', true, 0);
          hasError = true;
          continue;
        }
      }

      // 预校验输入
      const parsed = tool.inputSchema.safeParse(tc.input);
      if (!parsed.success) {
        results.push({ type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] 参数校验失败: ${parsed.error.message}`, is_error: true });
        callbacks.onToolEnd?.(tc.name, '[ERROR] 参数校验失败', true, 0);
        hasError = true;
        continue;
      }
      approvedTasks.push({ tc, kind: 'local', tool, parsedInput: parsed.data });
    }

    // ── Phase 2: 并发执行（附分级超时保护）──
    if (approvedTasks.length > 0) {
      const execPromises = approvedTasks.map(async (task): Promise<ToolResultContentBlock> => {
        const { tc } = task;
        const startTime = Date.now();
        const timeout = getTimeoutForTool(tc.name);

        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`工具 ${tc.name} 执行超时 (${timeout / 1000}s)`)), timeout)
          );

          let execPromise: Promise<ToolResultContentBlock>;
          if (task.kind === 'mcp') {
            execPromise = mcpManager.callTool(task.serverName!, task.originalToolName!, tc.input).then(res => {
              const durationMs = Date.now() - startTime;
              const isErr = res.isError ?? false;
              if (isErr) hasError = true;
              callbacks.onToolEnd?.(tc.name, res.output, isErr, durationMs);
              return { type: 'tool_result' as const, tool_use_id: tc.id, content: res.output, is_error: res.isError };
            });
          } else {
            execPromise = task.tool!.call(task.parsedInput, toolContext).then(result => {
              const durationMs = Date.now() - startTime;
              const isErr = result.isError ?? false;
              if (isErr) hasError = true;
              callbacks.onToolEnd?.(tc.name, result.output, isErr, durationMs);
              return { type: 'tool_result' as const, tool_use_id: tc.id, content: result.output, is_error: result.isError };
            });
          }

          return await Promise.race([execPromise, timeoutPromise]);
        } catch (err: unknown) {
          const durationMs = Date.now() - startTime;
          const msg = err instanceof Error ? err.message : String(err);
          callbacks.onToolEnd?.(tc.name, `[ERROR] ${msg}`, true, durationMs);
          hasError = true;
          return { type: 'tool_result', tool_use_id: tc.id, content: `[ERROR] 工具执行异常: ${msg}`, is_error: true };
        }
      });

      const settled = await Promise.allSettled(execPromises);
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({ type: 'tool_result', tool_use_id: 'unknown', content: `[ERROR] ${result.reason}`, is_error: true });
          hasError = true;
        }
      }
    }

    return { results, hasError };
  }
}
