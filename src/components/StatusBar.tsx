/**
 * StatusBar — 底部状态栏
 * 布局：左侧 "? for shortcuts"，右侧模型名 + token
 * 颜色：白色/灰色系
 */
import React from 'react';
import { Box, Text } from 'ink';
import { formatTokens } from '../utils/path.ts';

interface StatusBarProps {
  model: string;
  cwd: string;
  tokenCount?: number;
  isProcessing?: boolean;
}

export function StatusBar({ model, tokenCount, isProcessing }: StatusBarProps): React.ReactNode {
  const rightParts: string[] = [];
  if (tokenCount && tokenCount > 0) {
    rightParts.push(`${formatTokens(tokenCount)} tokens`);
  }
  rightParts.push(model);

  return (
    <Box width="100%" justifyContent="space-between">
      {/* 左侧：快捷键提示 */}
      <Text dimColor>? for shortcuts</Text>

      {/* 右侧 */}
      <Box gap={1}>
        {isProcessing && (
          <Text color="white">●</Text>
        )}
        <Text dimColor>{rightParts.join(' · ')}</Text>
      </Box>
    </Box>
  );
}
