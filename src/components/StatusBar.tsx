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
  model, tokenCount, isProcessing,
  contextWindow = 128_000, contextUsedTokens = 0, sessionCostUsd = 0,
}: StatusBarProps): React.ReactNode {
  const termWidth = process.stdout.columns || 80;

  // 上下文窗口进度条（仅当有 token 使用时显示）
  const contextBar = contextUsedTokens > 0 ? (
    <Box gap={1}>
      <Text dimColor>ctx</Text>
      <Text color={contextUsedTokens / contextWindow > 0.8 ? 'yellow' : 'green'}>
        {renderContextBar(contextUsedTokens, contextWindow)}
      </Text>
    </Box>
  ) : null;

  // Token 信息
  const tokensNode = (tokenCount && tokenCount > 0) ? (
    <Box gap={1}>
      <Text dimColor>tok</Text>
      <Text>{formatTokens(tokenCount)}</Text>
    </Box>
  ) : null;

  // 成本信息
  const costNode = sessionCostUsd > 0 ? (
    <Text color="yellow">{formatCost(sessionCostUsd)}</Text>
  ) : null;

  // 动态提示
  const centerText = isProcessing ? 'Ctrl+C to interrupt' : '';

  return (
    <Box flexDirection="column" width="100%">
      {/* 分隔线 */}
      <Box width="100%">
        <Text dimColor>{'─'.repeat(termWidth)}</Text>
      </Box>

      {/* 三栏内容 */}
      <Box width="100%" justifyContent="space-between">
        {/* 左侧 */}
        <Text dimColor>? for shortcuts</Text>

        {/* 中间 */}
        <Text dimColor italic>{centerText}</Text>

        {/* 右侧 */}
        <Box gap={2}>
          {isProcessing && (
            <Text color="cyan">● Processing</Text>
          )}
          {contextBar}
          {tokensNode}
          {costNode}
          <Box gap={1}>
            <Text dimColor>/model</Text>
            <Text>{model}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
