/**
 * StatusBar — 底部状态栏
 * 参考 Claude Code 的 StatusLine 组件
 * 持久展示模型名称、Token 计数、工作目录
 */
import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  model: string;
  cwd: string;
  tokenCount?: number;
  isProcessing?: boolean;
}

export function StatusBar({ model, cwd, tokenCount, isProcessing }: StatusBarProps): React.ReactNode {
  return (
    <Box width="100%" gap={2} paddingX={1}>
      {/* 模型 */}
      <Text dimColor>
        model: <Text color="yellowBright">{model}</Text>
      </Text>

      {/* Token 统计 */}
      {tokenCount !== undefined && tokenCount > 0 && (
        <Text dimColor>
          tokens: <Text color="cyan">{formatTokens(tokenCount)}</Text>
        </Text>
      )}

      {/* 工作目录 */}
      <Text dimColor>
        cwd: {shortenCwd(cwd)}
      </Text>

      {/* 处理状态 */}
      {isProcessing && (
        <Text color="cyan">●</Text>
      )}
    </Box>
  );
}

// ─── 辅助 ────────────────────────────────────────────────
function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 100_000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}

function shortenCwd(p: string): string {
  const home = process.env['HOME'] ?? '';
  if (home && p.startsWith(home)) {
    return '~' + p.slice(home.length);
  }
  return p;
}
