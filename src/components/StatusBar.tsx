/**
 * StatusBar — 底部状态栏
 *
 * 增强版（Claude Code 对齐）：
 * - 上下文窗口进度条可视化
 * - 实时成本显示
 * - Token 分类（prompt/completion）
 * - 快捷键面板提示
 */
import React from 'react';
import { Box, Text } from 'ink';
import { formatTokens } from '../utils/path.ts';

interface StatusBarProps {
  model: string;
  cwd: string;
  tokenCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  isProcessing?: boolean;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 已使用的上下文 token */
  contextUsedTokens?: number;
  /** 本次会话成本 USD */
  sessionCostUsd?: number;
}

/**
 * 生成上下文窗口进度条
 */
function renderContextBar(used: number, total: number): string {
  const ratio = Math.min(used / total, 1);
  const barWidth = 12;
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const pct = Math.round(ratio * 100);
  return `${bar} ${pct}%`;
}

/**
 * 格式化成本
 */
function formatCost(usd: number): string {
  if (usd < 0.001) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function StatusBar({
  model, cwd, tokenCount, promptTokens = 0, completionTokens = 0, isProcessing,
  contextWindow = 128_000, contextUsedTokens = 0, sessionCostUsd = 0,
}: StatusBarProps): React.ReactNode {
  const termWidth = process.stdout.columns || 80;
  const showTokens = isProcessing || (tokenCount && tokenCount > 0);
  const home = process.env.HOME || '';
  const shortCwd = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  return (
    <Box flexDirection="column" width="100%">
      {/* 分隔线（使用原生 Ink 软边框而非暴力字符串填充，完美自适应缩放） */}
      <Box width="100%" borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor="gray" paddingBottom={0} paddingTop={0}>
        <Box width="100%" justifyContent="space-between">
          <Box flexGrow={1} flexBasis="25%"><Text dimColor wrap="truncate-end">workspace (/cwd)</Text></Box>
          <Box flexGrow={1} flexBasis="25%"><Text dimColor wrap="truncate-end">context usage</Text></Box>
          <Box flexGrow={1} flexBasis="25%"><Text dimColor wrap="truncate-end">tokens (/cost)</Text></Box>
          <Box flexGrow={1} flexBasis="25%" justifyContent="flex-end"><Text dimColor wrap="truncate-end">/model</Text></Box>
        </Box>
      </Box>

      {/* 矩阵数值行 */}
      <Box width="100%" justifyContent="space-between">
        <Box flexGrow={1} flexBasis="25%" overflowX="hidden">
          <Text dimColor wrap="truncate-end">{shortCwd}</Text>
        </Box>
        
        <Box flexGrow={1} flexBasis="25%" overflowX="hidden">
          {contextUsedTokens > 0 ? (
            <Text color={contextUsedTokens / contextWindow > 0.8 ? 'yellow' : 'green'} wrap="truncate-end">
              {renderContextBar(contextUsedTokens, contextWindow)}
            </Text>
          ) : (
            <Text dimColor wrap="truncate-end">no context</Text>
          )}
        </Box>

        <Box flexGrow={1} flexBasis="25%" overflowX="hidden">
          {showTokens ? (
            <Text wrap="truncate-end">
              {formatTokens(tokenCount || 0)}
              {isProcessing ? <Text dimColor> ↑{formatTokens(promptTokens)} ↓{formatTokens(completionTokens)}</Text> : ''}
              {sessionCostUsd > 0 ? <Text color="yellow"> {formatCost(sessionCostUsd)}</Text> : ''}
            </Text>
          ) : (
            <Text dimColor wrap="truncate-end">-</Text>
          )}
        </Box>

        <Box flexGrow={1} flexBasis="25%" overflowX="hidden" justifyContent="flex-end">
          <Text color="cyan" wrap="truncate-end">{model}</Text>
        </Box>
      </Box>
    </Box>
  );
}
