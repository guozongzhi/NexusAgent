/**
 * PermissionPrompt — 工具执行权限确认
 * 黑白灰色系 + Always Allow 选项
 */
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface PermissionPromptProps {
  toolName: string;
  argsSummary: string;
  onApprove: () => void;
  onReject: () => void;
  /** 按 A 键触发：当前会话永久允许此工具 */
  onAlwaysAllow?: () => void;
}

export function PermissionPrompt({ toolName, argsSummary, onApprove, onReject, onAlwaysAllow }: PermissionPromptProps): React.ReactNode {
  const [hasResponded, setHasResponded] = useState(false);

  useInput((input, key) => {
    if (hasResponded) return;

    const char = input.toLowerCase();
    if (char === 'y' || key.return) {
      setHasResponded(true);
      onApprove();
    } else if (char === 'n' || key.escape) {
      setHasResponded(true);
      onReject();
    } else if (char === 'a' && onAlwaysAllow) {
      setHasResponded(true);
      onAlwaysAllow();
    }
  });

  if (hasResponded) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1} paddingLeft={2} borderStyle="round" borderColor="gray">
      <Text bold>⚠ 需要执行权限</Text>
      <Text>Agent 试图调用 <Text bold>{toolName}</Text></Text>
      <Text dimColor>参数: {argsSummary.length > 200 ? argsSummary.slice(0, 197) + '...' : argsSummary}</Text>

      <Box marginTop={1}>
        <Text dimColor>允许执行？ </Text>
        <Text>[<Text bold>Y</Text>es/Enter] </Text>
        <Text>[<Text bold>N</Text>o/Esc] </Text>
        {onAlwaysAllow && <Text>[<Text bold>A</Text>lways] </Text>}
      </Box>
    </Box>
  );
}
