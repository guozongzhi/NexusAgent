/**
 * StatusBar — 底部状态栏（对标 Gemini CLI 三栏布局）
 * 布局：分隔线 + 左/中/右三栏
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
  // 右侧 tokens 信息
  const tokensNode = (tokenCount && tokenCount > 0) ? (
    <Box gap={1}>
      <Text dimColor>/tokens</Text>
      <Text>{formatTokens(tokenCount)}</Text>
    </Box>
  ) : null;

  // 右侧 model 信息
  const modelNode = (
    <Box gap={1}>
      <Text dimColor>/model</Text>
      <Text>{model}</Text>
    </Box>
  );

  // 中间动态提示
  const centerText = isProcessing ? 'Ctrl+C to interrupt' : '';

  return (
    <Box flexDirection="column" width="100%">
      {/* 分隔线 */}
      <Box width="100%">
        <Text dimColor>{'─'.repeat(process.stdout.columns || 80)}</Text>
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
          {tokensNode}
          {modelNode}
        </Box>
      </Box>
    </Box>
  );
}
