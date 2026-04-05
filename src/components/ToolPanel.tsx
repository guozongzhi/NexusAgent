/**
 * ToolPanel — 工具执行可视化面板
 * 参考 Claude Code 的 AssistantToolUseMessage 组件
 * 在工具调用时展示 ⬤ 状态指示 + 工具名 + 参数摘要
 */
import React from 'react';
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
  /** 执行结果摘要（折叠/展开） */
  resultSummary?: string;
  /** 耗时 ms */
  durationMs?: number;
}

interface ToolPanelProps {
  tools: ToolExecution[];
  shouldAnimate: boolean;
}

/**
 * 工具执行面板 — 展示所有工具调用状态
 * 类似 Claude Code 中 ⬤ToolName (args) 的风格
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

  return (
    <Box flexDirection="column" marginTop={addMargin ? 1 : 0}>
      {/* 主行：状态点 + 工具名 + 参数 */}
      <Box flexDirection="row" flexWrap="nowrap">
        {/* 状态指示器 */}
        {isQueued ? (
          <Box minWidth={2}>
            <Text dimColor>⬤</Text>
          </Box>
        ) : (
          <ToolDot
            shouldAnimate={shouldAnimate && tool.status === 'running'}
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
            <Text> ({tool.paramSummary})</Text>
          </Box>
        )}

        {/* 耗时 */}
        {isResolved && tool.durationMs !== undefined && (
          <Text color="gray"> {formatDuration(tool.durationMs)}</Text>
        )}
      </Box>

      {/* 结果行（仅已完成时展示） */}
      {isResolved && tool.resultSummary && (
        <Box paddingLeft={2}>
          <Text color={isError ? 'red' : 'gray'} wrap="truncate-end">
            {tool.resultSummary}
          </Text>
        </Box>
      )}

      {/* 等待权限提示 */}
      {tool.status === 'running' && (
        <Box paddingLeft={2}>
          <Text dimColor>执行中...</Text>
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

/** 根据工具名称和输入生成显示名称 */
export function getToolDisplayName(toolName: string): string {
  const nameMap: Record<string, string> = {
    'bash': 'Bash',
    'file_read': 'Read',
    'file_write': 'Write',
    'file_edit': 'Edit',
    'list_dir': 'ListDir',
    'search': 'Search',
    'grep': 'Grep',
  };
  return nameMap[toolName] ?? toolName;
}

/** 根据工具输入生成参数摘要 */
export function getToolParamSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'bash': {
      const cmd = String(input.command ?? '');
      return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
    }
    case 'file_read':
    case 'file_write':
    case 'file_edit':
      return String(input.path ?? input.file_path ?? '');
    default:
      return '';
  }
}
