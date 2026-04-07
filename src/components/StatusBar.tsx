/**
 * StatusBar — Claude Code 风格底部状态栏
 *
 * 布局：左侧 "? for shortcuts"，右侧模型/token/状态信息
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

export function StatusBar({ model, cwd, tokenCount, isProcessing }: StatusBarProps): React.ReactNode {
  // 右侧信息片段
  const infoParts: string[] = [];
  if (tokenCount && tokenCount > 0) {
    infoParts.push(`${formatTokens(tokenCount)} tokens`);
  }

  return (
    <Box width="100%" justifyContent="space-between" paddingX={1}>
      {/* 左侧：快捷键提示 */}
      <Text dimColor>? for shortcuts</Text>

      {/* 右侧：模型 + token + 处理状态 */}
      <Box gap={1}>
        {isProcessing && (
          <Text color="cyan">●</Text>
        )}
        {infoParts.length > 0 && (
          <Text dimColor>{infoParts.join(' · ')}</Text>
        )}
      </Box>
    </Box>
  );
}
