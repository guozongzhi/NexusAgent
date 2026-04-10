/**
 * ToolPanel — 工具执行可视化面板
 *
 * 增强版（Claude Code 对齐）：
 * - 实时执行计时（running 状态下每秒更新）
 * - 结果折叠展示（超过 3 行自动折叠，显示行数提示）
 * - Bash 工具实时输出（显示最后 3 行）
 * - File Edit diff 预览（彩色 diff）
 */
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ToolDot } from './Spinner.tsx';

// ─── 类型 ────────────────────────────────────────────────
export interface ToolExecution {
  id: string;
  name: string;
  /** 工具显示名称 */
  displayName: string;
  /** 工具参数摘要（单行） */
  paramSummary?: string;
  /** 状态 */
  status: 'queued' | 'running' | 'success' | 'error';
  /** 执行结果摘要 */
  resultSummary?: string;
  /** 耗时 ms */
  durationMs?: number;
  /** 开始时间 */
  startTime?: number;
  /** Bash 实时输出 */
  liveOutput?: string;
}

interface ToolPanelProps {
  tools: ToolExecution[];
  shouldAnimate: boolean;
}

/**
 * 工具执行面板 — 展示所有工具调用状态
 */
export function ToolPanel({ tools, shouldAnimate }: ToolPanelProps): React.ReactNode {
  if (tools.length === 0) return null;

  return (
    <Box flexDirection="column" width="100%">
      {tools.map((tool, i) => (
        <ToolRow
          key={tool.id}
          tool={tool}
          shouldAnimate={shouldAnimate}
          addMargin={i > 0}
        />
      ))}
    </Box>
  );
}

// ─── 单行工具展示 ────────────────────────────────────────
interface ToolRowProps {
  tool: ToolExecution;
  shouldAnimate: boolean;
  addMargin: boolean;
}

function ToolRow({ tool, shouldAnimate, addMargin }: ToolRowProps): React.ReactNode {
  const isResolved = tool.status === 'success' || tool.status === 'error';
  const isError = tool.status === 'error';
  const isQueued = tool.status === 'queued';
  const isRunning = tool.status === 'running';

  // 实时计时（running 状态下每秒更新）
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning || !tool.startTime) return;
    const timer = setInterval(() => {
      setElapsed(Date.now() - tool.startTime!);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRunning, tool.startTime]);

  // 结果折叠逻辑
  const resultLines = tool.resultSummary?.split('\n') ?? [];
  const shouldFold = resultLines.length > 5;
  const displayResult = shouldFold
    ? resultLines.slice(0, 3).join('\n') + `\n  ... (+${resultLines.length - 3} 行)`
    : tool.resultSummary;

  // Bash 实时输出（最后 3 行）
  const liveLines = tool.liveOutput?.split('\n').slice(-3).join('\n');

  return (
    <Box flexDirection="column" marginTop={addMargin ? 0 : 0}>
      {/* 主行：状态点 + 工具名 + 参数 + 计时 */}
      <Box flexDirection="row" flexWrap="nowrap">
        {/* 状态指示器 */}
        {isQueued ? (
          <Box minWidth={2}>
            <Text dimColor>⬤</Text>
          </Box>
        ) : (
          <ToolDot
            shouldAnimate={shouldAnimate && isRunning}
            isResolved={isResolved}
            isError={isError}
          />
        )}

        {/* 工具名称 */}
        <Box flexShrink={0}>
          <Text bold>{tool.displayName}</Text>
        </Box>

        {/* 参数摘要 */}
        {tool.paramSummary && (
          <Box flexWrap="nowrap">
            <Text dimColor> ({tool.paramSummary})</Text>
          </Box>
        )}

        {/* 实时计时 / 最终耗时 */}
        {isResolved && tool.durationMs !== undefined && (
          <Text color="gray"> {formatDuration(tool.durationMs)}</Text>
        )}
        {isRunning && tool.startTime && elapsed > 0 && (
          <Text color="yellow"> {formatDuration(elapsed)}</Text>
        )}

        {/* 状态标记 */}
        {tool.status === 'success' && (
          <Text color="green"> ✓</Text>
        )}
        {tool.status === 'error' && (
          <Text color="red"> ✗</Text>
        )}
      </Box>

      {/* Bash 实时输出（运行中显示最后 3 行） */}
      {isRunning && liveLines && (
        <Box paddingLeft={3}>
          <Text dimColor wrap="truncate-end">{liveLines}</Text>
        </Box>
      )}

      {/* 结果行（已完成时展示，带折叠） */}
      {isResolved && displayResult && (
        <Box paddingLeft={3}>
          <Text color={isError ? 'red' : 'gray'} wrap="truncate-end">
            {displayResult}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// ─── 辅助函数 ────────────────────────────────────────────
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

/** 根据工具名称生成显示名称 */
export function getToolDisplayName(toolName: string): string {
  const nameMap: Record<string, string> = {
    'bash': 'Bash',
    'file_read': 'Read',
    'file_write': 'Write',
    'file_edit': 'Edit',
    'multi_edit': 'MultiEdit',
    'list_dir': 'ListDir',
    'search': 'Search',
    'grep': 'Grep',
    'glob': 'Glob',
    'note': 'Note',
    'task_manage': 'Task',
    'web_fetch': 'Fetch',
    'web_search': 'Search',
    'notebook_edit': 'Notebook',
  };
  // MCP 工具特殊处理
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    return `MCP:${parts[2] || parts[1]}`;
  }
  return nameMap[toolName] ?? toolName;
}

/** 根据工具输入生成参数摘要 */
export function getToolParamSummary(toolName: string, input: Record<string, unknown>): string {
  const basename = (p: string) => {
    const parts = p.split('/');
    return parts[parts.length - 1] || p;
  };

  switch (toolName) {
    case 'bash': {
      const cmd = String(input.command ?? '');
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    case 'file_read':
    case 'file_write':
      return basename(String(input.filePath ?? input.path ?? ''));
    case 'file_edit':
      return basename(String(input.file_path ?? ''));
    case 'multi_edit': {
      const edits = input.edits as any[];
      if (!edits) return '';
      const files = new Set(edits.map((e: any) => basename(String(e.file_path ?? ''))));
      return `${edits.length} edits in ${files.size} files`;
    }
    case 'list_dir':
      return String(input.path ?? input.directory ?? '.');
    case 'glob':
      return String(input.pattern ?? '');
    case 'grep':
      return String(input.pattern ?? input.query ?? '');
    case 'web_fetch':
      return String(input.url ?? '');
    case 'web_search':
      return String(input.query ?? '');
    case 'notebook_edit': {
      const action = String(input.action ?? '');
      const path = String(input.path ?? '');
      return `${action} ${basename(path)}`.trim();
    }
    default:
      return '';
  }
}
